import { Logger } from "@nestjs/common";
import { ColumnEntity } from "../../../database/entities/column.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { TaskEntity } from "../../../database/entities/task.entity";
import { insertReturning } from "../../../database/dml";
import { claimTaskNumber } from "../../../task/shared/claim-task-numbers";
import { taskUrl } from "../../chat/shared/task-url";
import { findExternalLink } from "../../links/external-link-queries";
import { createExternalLink } from "../../links/external-link-writes";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../links/extract-priority";
import { formatTaskDescriptionFromIssue } from "../../links/issue-format";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { createIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { importIssueLabels } from "../../sync/issue-labels";
import { acceptsIssue } from "../../sync/rules";
import type { GitHubOctokit } from "../app/github-app";
import type { GitHubConfig } from "../config/github-config";
import type { GitHubDeps } from "../github-deps";
import { addLabelsToIssue } from "../labels/github-labels";
import { findRepositoryIntegrations } from "./find-repository-integrations";

const logger = new Logger("GitHubIssueOpened");

export type IssueOpenedPayload = {
  action: string;
  issue: {
    number: number;
    title: string;
    state?: string;
    body: string | null;
    html_url: string;
    labels?: Array<string | { name?: string; color?: string }>;
    user: { login: string } | null;
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
    full_name: string;
  };
};

/**
 * Creates a task (and its issue link) for a new issue in every admitting
 * integration, then labels the issue and comments the task link.
 * `integrationId` limits this to one integration (a label admitting an issue).
 */
export async function handleIssueOpened(
  deps: GitHubDeps,
  payload: IssueOpenedPayload,
  integrationId?: string,
): Promise<void> {
  const githubApp = deps.github.app();
  if (!githubApp) return;

  const { issue, repository } = payload;

  const appName = process.env.GITHUB_APP_NAME;
  if (appName && issue.user?.login === `${appName}[bot]`) {
    logger.log(
      `Issue #${issue.number} was created by the configured GitHub App, skipping task creation`,
    );
    return;
  }

  const integrations = (
    await findRepositoryIntegrations(deps.db, payload)
  ).filter((integration) => !integrationId || integration.id === integrationId);

  for (const integration of integrations) {
    if (!acceptsIssue(integration.config, issue.labels)) continue;
    const config = JSON.parse(integration.config) as GitHubConfig;
    const projectId = integration.projectId;
    const closed = issue.state === "closed";

    const priority = extractIssuePriority(issue.labels);
    const status = extractIssueStatus(issue.labels);

    const result = await deps.db.transaction(async (tx) => {
      // Use the same integration lock as resumable imports before checking the
      // link. The task and link must either both commit or both roll back.
      const [current] = (await tx.query(
        `SELECT is_active AS "isActive", config FROM integration WHERE id = $1 FOR UPDATE`,
        [integration.id],
      )) as { isActive: boolean | null; config: string }[];
      if (!current?.isActive || current.config !== integration.config)
        return null;
      const existingLink = await findExternalLink(
        tx,
        integration.id,
        "issue",
        String(issue.number),
      );
      if (existingLink) return null;
      const targetStatus = await resolveTargetStatus(
        tx,
        "github",
        projectId,
        closed ? "issue_closed" : "issue_opened",
        closed ? "done" : status || "to-do",
      );
      let targetColumn = await tx.findOne(ColumnEntity, {
        where: { projectId, slug: targetStatus },
      });
      if (closed && !targetColumn?.isFinal)
        targetColumn = await tx.findOne(ColumnEntity, {
          where: { projectId, isFinal: true },
          order: { position: "ASC" },
        });
      const number = await claimTaskNumber(tx, projectId);
      const task = await insertReturning(tx, TaskEntity, {
        projectId,
        userId: null,
        title: issue.title,
        description: formatTaskDescriptionFromIssue(issue.body),
        status: closed ? (targetColumn?.slug ?? "done") : targetStatus,
        columnId: targetColumn?.id ?? null,
        priority: priority ?? "low",
        number,
      });
      if (!task) throw new Error("Failed to create task from GitHub issue");
      const link = await createExternalLink(tx, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: String(issue.number),
        url: issue.html_url,
        title: issue.title,
        metadata: {
          state: closed ? "closed" : "open",
          createdFrom: "github",
          author: issue.user?.login,
        },
      });
      await importIssueLabels(
        tx,
        task.id,
        integration.project.workspaceId,
        issue.labels,
      );
      const eligible = await canSyncTask(
        tx,
        task.id,
        integration.id,
        integration.config,
      );
      return { task, link, eligible };
    });
    if (!result) continue;
    const { task: createdTask, link, eligible } = result;
    await deps.events.publish("task.created", {
      ...createdTask,
      taskId: createdTask.id,
      userId: createdTask.userId ?? "",
      type: "task",
      content: null,
      source: "github",
      externalId: issue.number.toString(),
      actor: issue.user?.login ?? "github-webhook",
    });
    if (!eligible) continue;
    const write = createIssueWrite(
      deps.db,
      { id: link.id, taskId: createdTask.id, integrationId: integration.id },
      integration.config,
    );

    const project = await deps.db.findOne(ProjectEntity, {
      where: { id: projectId },
    });
    if (!project) {
      logger.error("Project not found for task linking comment");
      continue;
    }

    const url = taskUrl({
      id: createdTask.id,
      projectId,
      workspaceId: project.workspaceId,
    });
    const taskIdentifier = `${project.slug.toUpperCase()}-${createdTask.number}`;

    try {
      let installationId = config.installationId;
      if (!installationId) {
        const { data: installation } =
          await githubApp.octokit.rest.apps.getRepoInstallation({
            owner: repository.owner.login,
            repo: repository.name,
          });
        installationId = installation.id;
      }

      const octokit = (await githubApp.getInstallationOctokit(
        installationId,
      )) as unknown as GitHubOctokit;

      const existingLabels =
        issue.labels
          ?.map((label) => (typeof label === "string" ? label : label.name))
          .filter(Boolean) || [];

      const labelsToAdd: string[] = [];
      if (priority && !existingLabels.includes(`priority:${priority}`)) {
        labelsToAdd.push(`priority:${priority}`);
      }
      if (status && !existingLabels.includes(`status:${status}`)) {
        labelsToAdd.push(`status:${status}`);
      }

      if (labelsToAdd.length > 0) {
        await addLabelsToIssue(
          octokit,
          repository.owner.login,
          repository.name,
          issue.number,
          labelsToAdd,
          true,
          write,
        );
      }

      if (config.commentTaskLinkOnGitHubIssue !== false) {
        await write(() =>
          octokit.rest.issues.createComment({
            owner: repository.owner.login,
            repo: repository.name,
            issue_number: issue.number,
            body: `[${taskIdentifier}](${url})`,
          }),
        );
      }
    } catch {
      logger.error(
        `GitHub imported issue linking write failed (project ${projectId}, task ${createdTask.id}, integration ${integration.id}, link ${link.id})`,
      );
    }
  }
}
