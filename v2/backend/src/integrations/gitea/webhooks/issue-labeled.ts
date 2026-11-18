import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { insertReturning } from "../../../database/dml";
import { LabelEntity } from "../../../database/entities/label.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import type { EventBus } from "../../../events/event-bus";
import { errorText } from "../../git-shared/error-text";
import { findExternalLink } from "../../links/external-link-queries";
import { updateExternalLink } from "../../links/external-link-writes";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../links/extract-priority";
import { findLinkedTask } from "../../links/integration-task-scope";
import { updateTaskStatus } from "../../links/integration-tasks";
import { withIntegrationLink } from "../../links/with-integration-link";
import { resumeLabelChanges } from "../../sync/resume-label-changes";
import { acceptsIssue, readSyncRules } from "../../sync/rules";
import {
  findGiteaIntegrations,
  type GiteaWebhookRepository,
  repoOwnerLogin,
} from "../webhook/gitea-webhook-repository";
import { handleGiteaIssueOpened, type IssueOpenedPayload } from "./issue-opened";
import { publishStatusChange } from "./publish-status-change";
import {
  giteaLabelsForSync,
  syncGiteaLabelsToTask,
} from "./sync-gitea-labels-to-task";
import { isSystemLabelName } from "./system-labels";

const logger = new Logger("GiteaIssueLabeled");

export type IssueLabeledPayload = {
  action: string;
  issue: {
    number: number;
    labels?: Array<string | { name?: string; color?: string }>;
  };
  label?: {
    name: string;
    color: string;
  };
  repository: GiteaWebhookRepository;
};

async function workspaceOf(
  tx: EntityManager,
  taskId: string,
  projectId: string,
): Promise<{ taskId: string; workspaceId: string } | undefined> {
  const task = await findLinkedTask(tx, taskId, projectId);
  if (!task) return;
  const project = await tx.findOne(ProjectEntity, {
    where: { id: task.projectId },
  });
  return project?.workspaceId
    ? { taskId: task.id, workspaceId: project.workspaceId }
    : undefined;
}

/**
 * Issue labels changed in Gitea: `priority:`/`status:` labels update the
 * task's fields, other labels are mirrored onto the task. An unlinked issue
 * that now matches a label-based incoming rule is imported.
 */
export async function handleGiteaIssueLabeled(
  db: EntityManager,
  events: EventBus,
  payload: IssueLabeledPayload,
  integrationId?: string,
): Promise<void> {
  const { issue, repository, label: addedLabel } = payload;

  const integrations = await findGiteaIntegrations(
    db,
    repository,
    integrationId,
  );

  for (const integration of integrations) {
    try {
      const existingLink = await findExternalLink(
        db,
        integration.id,
        "issue",
        issue.number.toString(),
      );

      if (!existingLink) {
        const fullIssue = issue as typeof issue &
          Partial<IssueOpenedPayload["issue"]>;
        if (
          ["label_updated", "labeled"].includes(payload.action) &&
          readSyncRules(integration.config)?.incoming.mode === "labels" &&
          acceptsIssue(integration.config, issue.labels) &&
          fullIssue.title &&
          fullIssue.html_url
        ) {
          await handleGiteaIssueOpened(
            db,
            events,
            payload as unknown as IssueOpenedPayload,
            integration.id,
          );
        }
        continue;
      }

      await withIntegrationLink(
        db,
        existingLink,
        integration,
        async (tx, afterCommit, locked) => {
          const names = (issue.labels ?? []).flatMap((label) => {
            const name = typeof label === "string" ? label : label.name;
            return name ? [name] : [];
          });
          const changes = resumeLabelChanges(locked, names);
          if (changes.baseline && issue.labels !== undefined)
            await updateExternalLink(tx, locked.id, {
              metadata: { syncResumeLabelBaseline: names },
            });
          const priority = extractIssuePriority(issue.labels);
          const status = extractIssueStatus(issue.labels);

          if (priority && changes.priorityChanged) {
            await tx.query(
              `UPDATE task SET priority = $1, updated_at = $2 WHERE id = $3 AND project_id = $4`,
              [priority, new Date(), locked.taskId, integration.projectId],
            );
          }

          if (status && changes.statusChanged) {
            publishStatusChange(
              events,
              afterCommit,
              await updateTaskStatus(tx, locked.taskId, status),
            );
          }

          const publishLabels = () =>
            afterCommit(() =>
              events.publish("task.labels_updated", {
                projectId: integration.projectId,
                taskId: locked.taskId,
              }),
            );
          const publishUpdated = () =>
            afterCommit(() =>
              events.publish("task.updated", {
                projectId: integration.projectId,
                taskId: locked.taskId,
              }),
            );

          if (payload.action === "label_updated") {
            if (issue.labels === undefined) {
              return;
            }
            const scope = await workspaceOf(
              tx,
              locked.taskId,
              integration.projectId,
            );
            if (scope) {
              await syncGiteaLabelsToTask(
                tx,
                locked.taskId,
                scope.workspaceId,
                giteaLabelsForSync(issue.labels),
                changes.baseline,
              );
              publishLabels();
            }
            return;
          }

          if (!addedLabel || isSystemLabelName(addedLabel.name)) {
            if (priority) publishUpdated();
            return;
          }

          if (payload.action === "labeled") {
            const scope = await workspaceOf(
              tx,
              locked.taskId,
              integration.projectId,
            );
            if (scope) {
              const existingLabel = await tx.findOne(LabelEntity, {
                where: {
                  workspaceId: scope.workspaceId,
                  name: addedLabel.name,
                  taskId: scope.taskId,
                },
              });

              if (!existingLabel) {
                const color = addedLabel.color
                  ? `#${addedLabel.color.replace(/^#/, "")}`
                  : "#6B7280";
                await insertReturning(
                  tx,
                  LabelEntity,
                  {
                    name: addedLabel.name,
                    color,
                    taskId: scope.taskId,
                    workspaceId: scope.workspaceId,
                  },
                  { onConflict: { target: ["taskId", "name"] } },
                );
              }
            }
          }

          if (payload.action === "unlabeled") {
            await tx.delete(LabelEntity, {
              taskId: locked.taskId,
              name: addedLabel.name,
            });
          }
          publishLabels();
        },
      );
    } catch (error) {
      logger.error(
        `Gitea issue_labeled handler failed for integration ${integration.id} (issue #${issue.number}, ${repoOwnerLogin(repository)}/${repository.name}): ${errorText(error)}`,
      );
    }
  }
}
