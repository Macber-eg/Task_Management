import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { updateReturning } from "../../../database/dml";
import { TaskEntity } from "../../../database/entities/task.entity";
import type { EventBus } from "../../../events/event-bus";
import { findExternalLink } from "../../links/external-link-queries";
import { updateExternalLink } from "../../links/external-link-writes";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../links/extract-priority";
import { updateTaskStatus } from "../../links/integration-tasks";
import { withIntegrationLink } from "../../links/with-integration-link";
import { resumeLabelChanges } from "../../sync/resume-label-changes";
import { acceptsIssue, readSyncRules } from "../../sync/rules";
import { errorText } from "../../git-shared/error-text";
import { taskDescriptionFromIssue } from "../sync/issue-description";
import {
  isEchoOf,
  type LinkMetadata,
  parseLinkSyncMetadata,
} from "../sync/link-sync";
import { findAllIntegrationsByGitlabProject } from "../webhook/find-gitlab-integrations";
import {
  type GitlabWebhookLabel,
  type GitlabWebhookProject,
  labelTitles,
} from "../webhook/payload";
import { baseUrlFromProjectWebUrl } from "../webhook/webhook-project";
import { handleGitlabIssueOpened } from "./issue-opened";
import { publishStatusChange } from "./publish-status-change";
import {
  nonSystemLabels,
  syncGitlabLabelsToTask,
} from "./sync-gitlab-labels-to-task";

const logger = new Logger("GitlabIssueUpdated");

// Edits and label changes arrive together as one "update" action.
export type IssueUpdatedPayload = {
  object_attributes: {
    iid: number;
    title: string;
    state?: string;
    description: string | null;
    url: string;
    action?: string;
  };
  labels?: GitlabWebhookLabel[];
  changes?: {
    title?: { previous?: string | null; current?: string | null };
    description?: { previous?: string | null; current?: string | null };
    labels?: {
      previous?: GitlabWebhookLabel[];
      current?: GitlabWebhookLabel[];
    };
  };
  project: GitlabWebhookProject;
};

/**
 * Applies a GitLab issue edit to its task: title and description (unless they
 * echo Kaneo's own write), priority/status labels and the task's labels. An
 * unlinked issue that now matches a label-based incoming rule is imported.
 */
export async function handleGitlabIssueUpdated(
  db: EntityManager,
  events: EventBus,
  payload: IssueUpdatedPayload,
  integrationId?: string,
) {
  const issue = payload.object_attributes;
  const { project, changes } = payload;

  const touchedText = Boolean(changes?.title || changes?.description);
  const touchedLabels = Boolean(changes?.labels);

  if (!touchedText && !touchedLabels) {
    return;
  }

  const baseUrl = baseUrlFromProjectWebUrl(
    project.web_url,
    project.path_with_namespace,
  );
  if (!baseUrl) return;

  const integrations = await findAllIntegrationsByGitlabProject(
    db,
    baseUrl,
    project.path_with_namespace,
    integrationId,
  );

  const currentLabels = changes?.labels?.current ?? payload.labels;

  for (const integration of integrations) {
    try {
      const externalLink = await findExternalLink(
        db,
        integration.id,
        "issue",
        issue.iid.toString(),
      );

      if (!externalLink) {
        if (
          touchedLabels &&
          readSyncRules(integration.config)?.incoming.mode === "labels" &&
          acceptsIssue(integration.config, currentLabels)
        ) {
          await handleGitlabIssueOpened(
            db,
            events,
            { ...payload, labels: currentLabels },
            integration.id,
          );
        }
        continue;
      }

      await withIntegrationLink(
        db,
        externalLink,
        integration,
        async (tx, afterCommit, lockedLink) => {
          const task = await tx.findOne(TaskEntity, {
            where: { id: lockedLink.taskId, projectId: integration.projectId },
            relations: { project: true },
          });

          if (!task) {
            return;
          }

          let metadata: LinkMetadata = parseLinkSyncMetadata(
            lockedLink.metadata,
            { externalLinkId: lockedLink.id, field: "issue" },
          );

          if (touchedText) {
            const updateData: { title?: string; description?: string } = {};
            const lastSync = { ...metadata.lastSync };
            const now = new Date().toISOString();

            if (
              changes?.title &&
              !isEchoOf(metadata.lastSync?.title, "kaneo", issue.title)
            ) {
              updateData.title = issue.title;
              lastSync.title = {
                timestamp: now,
                source: "gitlab",
                value: issue.title,
              };
            }

            if (changes?.description) {
              // Kaneo recorded the body with its footer, so compare the raw body.
              const issueBody = issue.description ?? "";
              if (
                !isEchoOf(metadata.lastSync?.description, "kaneo", issueBody)
              ) {
                const description = taskDescriptionFromIssue(issue.description);
                updateData.description = description;
                lastSync.description = {
                  timestamp: now,
                  source: "gitlab",
                  value: description,
                };
              }
            }

            if (Object.keys(updateData).length > 0) {
              await updateReturning(tx, TaskEntity, updateData, {
                id: task.id,
                projectId: integration.projectId,
              });

              metadata = { ...metadata, lastSync };

              await updateExternalLink(tx, lockedLink.id, {
                title: issue.title,
                metadata,
              });
              afterCommit(() =>
                events.publish("task.updated", {
                  projectId: integration.projectId,
                  taskId: task.id,
                  ...(typeof updateData.title === "string"
                    ? { titleChanged: true }
                    : {}),
                }),
              );
            }
          }

          if (!touchedLabels || !currentLabels) {
            return;
          }

          const titles = labelTitles(currentLabels);
          const labelChanges = resumeLabelChanges(lockedLink, titles);
          if (labelChanges.baseline)
            await updateExternalLink(tx, lockedLink.id, {
              metadata: { syncResumeLabelBaseline: titles },
            });

          const priority = extractIssuePriority(titles);
          const status = extractIssueStatus(titles);

          if (priority && labelChanges.priorityChanged) {
            await updateReturning(
              tx,
              TaskEntity,
              { priority },
              { id: task.id, projectId: integration.projectId },
            );
          }

          // Unrelated label edits also include the full label snapshot. Its status
          // can predate a close/reopen, so only apply an actual status-label change.
          const previousStatus = extractIssueStatus(
            labelTitles(changes?.labels?.previous),
          );
          if (
            status &&
            labelChanges.statusChanged &&
            status !== previousStatus
          ) {
            publishStatusChange(
              events,
              afterCommit,
              await updateTaskStatus(tx, task.id, status),
              integration.id,
            );
          }

          if (task.project?.workspaceId) {
            await syncGitlabLabelsToTask(
              tx,
              task.id,
              task.project.workspaceId,
              nonSystemLabels(currentLabels),
              changes?.labels?.previous,
              labelChanges.baseline,
            );
            afterCommit(() =>
              events.publish("task.labels_updated", {
                projectId: integration.projectId,
                taskId: task.id,
              }),
            );
          }
        },
      );
    } catch (error) {
      logger.error(
        `GitLab issue update handler failed (integration ${integration.id}, issue ${issue.iid}, project ${project.path_with_namespace}): ${errorText(error)}`,
      );
    }
  }
}
