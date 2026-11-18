import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { ColumnEntity } from "../../../database/entities/column.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { TaskEntity } from "../../../database/entities/task.entity";
import type { EventBus } from "../../../events/event-bus";
import { claimTaskNumber } from "../../../task/shared/claim-task-numbers";
import { findExternalLink } from "../../links/external-link-queries";
import {
  createExternalLink,
  updateExternalLink,
} from "../../links/external-link-writes";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../links/extract-priority";
import { resolveTargetStatus } from "../../links/resolve-target-status";
import { createIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { importIssueLabels } from "../../sync/issue-labels";
import { acceptsIssue } from "../../sync/rules";
import { createGitlabClient } from "../client/gitlab-client";
import type { GitlabConfig } from "../config";
import { taskDescriptionFromIssue } from "../sync/issue-description";
import { withSyncedNoteId } from "../sync/synced-notes";
import { updateIssueLabelsGitlab } from "../labels/issue-labels";
import { findAllIntegrationsByGitlabProject } from "../webhook/find-gitlab-integrations";
import {
  type GitlabWebhookLabel,
  type GitlabWebhookProject,
  type GitlabWebhookUser,
  labelTitles,
} from "../webhook/payload";
import { baseUrlFromProjectWebUrl } from "../webhook/webhook-project";

const logger = new Logger("GitlabIssueOpened");

export type IssueOpenedPayload = {
  user?: GitlabWebhookUser | null;
  object_attributes: {
    iid: number;
    title: string;
    state?: string;
    description: string | null;
    url: string;
    action?: string;
    confidential?: boolean;
  };
  labels?: GitlabWebhookLabel[];
  project: GitlabWebhookProject;
};

/**
 * Creates a task (and its link) for a GitLab issue accepted by the incoming
 * sync rule, then labels the issue and comments the task link back.
 */
export async function handleGitlabIssueOpened(
  db: EntityManager,
  events: EventBus,
  payload: IssueOpenedPayload,
  integrationId?: string,
) {
  const issue = payload.object_attributes;
  const { project } = payload;

  // Confidential issues are visible only to project members in GitLab.
  if (issue.confidential) {
    return;
  }

  const baseUrl = baseUrlFromProjectWebUrl(
    project.web_url,
    project.path_with_namespace,
  );
  if (!baseUrl) {
    return;
  }

  const integrations = await findAllIntegrationsByGitlabProject(
    db,
    baseUrl,
    project.path_with_namespace,
    integrationId,
  );

  if (integrations.length === 0) {
    return;
  }

  const existingLabels = labelTitles(payload.labels);
  const author = payload.user?.username ?? payload.user?.name;

  for (const integration of integrations) {
    if (!acceptsIssue(integration.config, payload.labels)) continue;
    let config: GitlabConfig;
    try {
      config = JSON.parse(integration.config) as GitlabConfig;
    } catch {
      logger.error(
        `Invalid GitLab config for integration ${integration.id}`,
      );
      continue;
    }
    const projectId = integration.projectId;
    const closed = issue.state === "closed";

    const priority = extractIssuePriority(existingLabels);
    const status = extractIssueStatus(existingLabels);

    const result = await db.transaction(async (tx) => {
      const [current] = (await tx.query(
        `SELECT is_active AS "isActive", config FROM integration WHERE id = $1 FOR UPDATE`,
        [integration.id],
      )) as { isActive: boolean | null; config: string }[];
      if (
        !current?.isActive ||
        current.config !== integration.config ||
        !acceptsIssue(current.config, payload.labels)
      )
        return null;
      if (await findExternalLink(tx, integration.id, "issue", String(issue.iid)))
        return null;
      const resolvedStatus = await resolveTargetStatus(
        tx,
        "gitlab",
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
        description: taskDescriptionFromIssue(issue.description),
        status: closed ? (targetColumn?.slug ?? "done") : resolvedStatus,
        columnId: targetColumn?.id ?? null,
        priority: priority ?? "low",
        number: nextTaskNumber,
      });
      if (!task) throw new Error("Failed to create task from gitlab issue");
      const linkMetadata = {
        state: closed ? "closed" : "opened",
        createdFrom: "gitlab",
        author: author,
      };
      const link = await createExternalLink(tx, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: String(issue.iid),
        url: issue.url,
        title: issue.title,
        metadata: linkMetadata,
      });
      await importIssueLabels(
        tx,
        task.id,
        integration.project.workspaceId,
        payload.labels,
      );
      const eligible = await canSyncTask(
        tx,
        task.id,
        integration.id,
        integration.config,
      );
      return { task, link, linkMetadata, eligible };
    });
    if (!result) continue;
    const {
      task: createdTask,
      link: issueLink,
      linkMetadata,
      eligible,
    } = result;

    await events.publish("task.created", {
      ...createdTask,
      taskId: createdTask.id,
      userId: createdTask.userId ?? "",
      type: "task",
      content: null,
      source: "gitlab",
      externalId: issue.iid.toString(),
      actor: author ?? "gitlab-webhook",
    });
    if (!eligible) continue;
    const write = createIssueWrite(
      db,
      {
        id: issueLink.id,
        taskId: createdTask.id,
        integrationId: integration.id,
      },
      integration.config,
    );

    const kaneoProject = await db.findOne(ProjectEntity, {
      where: { id: projectId },
    });

    if (!kaneoProject) {
      continue;
    }

    const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
    const taskUrl = `${clientUrl}/dashboard/workspace/${kaneoProject.workspaceId}/project/${projectId}/task/${createdTask.id}`;
    const taskIdentifier = `${kaneoProject.slug.toUpperCase()}-${createdTask.number}`;

    try {
      const labelsToAdd: string[] = [];

      if (priority && !existingLabels.includes(`priority:${priority}`)) {
        labelsToAdd.push(`priority:${priority}`);
      }

      if (status && !existingLabels.includes(`status:${status}`)) {
        labelsToAdd.push(`status:${status}`);
      }

      if (labelsToAdd.length > 0) {
        await updateIssueLabelsGitlab(
          config,
          issue.iid,
          { add: labelsToAdd },
          true,
          write,
        );
      }

      if (config.commentTaskLinkOnGitlabIssue !== false) {
        const note = await write(() =>
          createGitlabClient(config).createIssueNote(
            config.projectPath,
            issue.iid,
            `[${taskIdentifier}](${taskUrl})`,
          ),
        );

        await updateExternalLink(db, issueLink.id, {
          metadata: {
            ...linkMetadata,
            syncedNoteIds: withSyncedNoteId([], note.id),
          },
        });
      }
    } catch {
      logger.error(
        `GitLab imported issue linking write failed (project ${projectId}, task ${createdTask.id}, integration ${integration.id}, link ${issueLink.id})`,
      );
    }
  }
}
