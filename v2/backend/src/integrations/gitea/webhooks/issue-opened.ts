import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { ColumnEntity } from "../../../database/entities/column.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { TaskEntity } from "../../../database/entities/task.entity";
import type { EventBus } from "../../../events/event-bus";
import { claimTaskNumber } from "../../../task/shared/claim-task-numbers";
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
import { createGiteaClient } from "../client/gitea-client";
import { markKaneoComment } from "../comment-origin";
import type { GiteaConfig } from "../config";
import { addLabelsToIssueGitea } from "../labels/gitea-issue-labels";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
} from "../webhook/gitea-webhook-repository";

const logger = new Logger("GiteaIssueOpened");

export type IssueOpenedPayload = {
  action: string;
  issue: {
    number: number;
    title: string;
    state?: string;
    body: string | null;
    html_url: string;
    labels?: Array<string | { name?: string; color?: string }>;
    user: { login?: string; username?: string } | null;
  };
  repository: GiteaWebhookRepository;
};

/**
 * Creates a task (and its link) for a Gitea issue accepted by the incoming
 * sync rule, then labels the issue and comments the task link back.
 */
export async function handleGiteaIssueOpened(
  db: EntityManager,
  events: EventBus,
  payload: IssueOpenedPayload,
  integrationId?: string,
): Promise<void> {
  const { issue, repository } = payload;

  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  for (const integration of integrations) {
    if (!acceptsIssue(integration.config, issue.labels)) continue;
    let config: GiteaConfig;
    try {
      config = JSON.parse(integration.config) as GiteaConfig;
    } catch {
      logger.error(`Invalid Gitea config for integration ${integration.id}`);
      continue;
    }
    const projectId = integration.projectId;
    const workspaceId = integration.project?.workspaceId ?? "";
    const closed = issue.state === "closed";

    const priority = extractIssuePriority(issue.labels);
    const status = extractIssueStatus(issue.labels);
    const author = issue.user?.login ?? issue.user?.username;

    const result = await db.transaction(async (tx) => {
      const [current] = (await tx.query(
        `SELECT is_active AS "isActive", config FROM integration WHERE id = $1 FOR UPDATE`,
        [integration.id],
      )) as { isActive: boolean | null; config: string }[];
      if (
        !current?.isActive ||
        current.config !== integration.config ||
        !acceptsIssue(current.config, issue.labels)
      )
        return null;
      if (
        await findExternalLink(tx, integration.id, "issue", String(issue.number))
      )
        return null;
      const resolvedStatus = await resolveTargetStatus(
        tx,
        "gitea",
        projectId,
        closed ? "issue_closed" : "issue_opened",
        closed ? "done" : status || "to-do",
      );
      let targetColumn = await tx.findOne(ColumnEntity, {
        where: { projectId, slug: resolvedStatus },
      });
      if (closed && !targetColumn?.isFinal)
        targetColumn = await tx.findOne(ColumnEntity, {
          where: { projectId, isFinal: true },
          order: { position: "ASC" },
        });
      const nextTaskNumber = await claimTaskNumber(tx, projectId);
      const task = await insertReturning(tx, TaskEntity, {
        projectId,
        userId: null,
        title: issue.title,
        description: formatTaskDescriptionFromIssue(issue.body),
        status: closed ? (targetColumn?.slug ?? "done") : resolvedStatus,
        columnId: targetColumn?.id ?? null,
        priority: priority ?? "low",
        number: nextTaskNumber,
      });
      if (!task) throw new Error("Failed to create task from gitea issue");
      const link = await createExternalLink(tx, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: String(issue.number),
        url: issue.html_url,
        title: issue.title,
        metadata: {
          state: closed ? "closed" : "open",
          createdFrom: "gitea",
          author,
        },
      });
      await importIssueLabels(tx, task.id, workspaceId, issue.labels);
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

    await events.publish("task.created", {
      ...createdTask,
      taskId: createdTask.id,
      userId: createdTask.userId ?? "",
      type: "task",
      content: null,
      source: "gitea",
      externalId: issue.number.toString(),
      actor: author ?? "gitea-webhook",
    });
    if (!eligible) continue;
    const write = createIssueWrite(
      db,
      { id: link.id, taskId: createdTask.id, integrationId: integration.id },
      integration.config,
    );

    const project = await db.findOne(ProjectEntity, {
      where: { id: projectId },
    });
    if (!project) {
      continue;
    }

    const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
    const taskUrl = `${clientUrl}/dashboard/workspace/${project.workspaceId}/project/${projectId}/task/${createdTask.id}`;
    const taskIdentifier = `${project.slug.toUpperCase()}-${createdTask.number}`;

    try {
      const client = createGiteaClient(config);

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
        await addLabelsToIssueGitea(
          config,
          issue.number,
          labelsToAdd,
          true,
          write,
        );
      }

      if (config.commentTaskLinkOnGiteaIssue !== false) {
        await write(() =>
          client.createIssueComment(
            config.repositoryOwner,
            config.repositoryName,
            issue.number,
            markKaneoComment(`[${taskIdentifier}](${taskUrl})`),
          ),
        );
      }
    } catch {
      logger.error(
        `Gitea imported issue linking write failed (project ${projectId}, task ${createdTask.id}, integration ${integration.id}, link ${link.id})`,
      );
    }
  }
}
