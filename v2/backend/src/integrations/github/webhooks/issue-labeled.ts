import { LabelEntity } from "../../../database/entities/label.entity";
import { ProjectEntity } from "../../../database/entities/project.entity";
import { insertReturning } from "../../../database/dml";
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
import type { GitHubDeps } from "../github-deps";
import { findRepositoryIntegrations } from "./find-repository-integrations";
import { handleIssueOpened, type IssueOpenedPayload } from "./issue-opened";

export type IssueLabeledPayload = {
  action: string;
  issue: {
    number: number;
    labels?: Array<string | { name?: string }>;
  };
  label?: { name: string; color: string };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
};

/**
 * `issues.labeled` / `issues.unlabeled`: applies `priority:`/`status:` labels
 * to the linked task and mirrors other labels onto it. An unlinked issue a
 * label rule now admits is imported.
 */
export async function handleIssueLabeled(
  deps: GitHubDeps,
  payload: IssueLabeledPayload,
): Promise<void> {
  const { issue, label: addedLabel } = payload;

  for (const integration of await findRepositoryIntegrations(deps.db, payload)) {
    const existingLink = await findExternalLink(
      deps.db,
      integration.id,
      "issue",
      issue.number.toString(),
    );

    if (!existingLink) {
      const fullIssue = issue as typeof issue &
        Partial<IssueOpenedPayload["issue"]>;
      if (
        payload.action === "labeled" &&
        readSyncRules(integration.config)?.incoming.mode === "labels" &&
        acceptsIssue(integration.config, issue.labels) &&
        fullIssue.title &&
        fullIssue.html_url
      ) {
        await handleIssueOpened(
          deps,
          payload as unknown as IssueOpenedPayload,
          integration.id,
        );
      }
      continue;
    }

    await withIntegrationLink(
      deps.db,
      existingLink,
      integration,
      async (tx, afterCommit, lockedLink) => {
        const taskUpdated = () =>
          afterCommit(() =>
            deps.events.publish("task.updated", {
              projectId: integration.projectId,
              taskId: lockedLink.taskId,
            }),
          );
        const names = (issue.labels ?? []).flatMap((label) => {
          const name = typeof label === "string" ? label : label.name;
          return name ? [name] : [];
        });
        const changes = resumeLabelChanges(lockedLink, names);
        if (changes.baseline && issue.labels !== undefined)
          await updateExternalLink(tx, lockedLink.id, {
            metadata: { syncResumeLabelBaseline: names },
          });
        const priority = extractIssuePriority(issue.labels);
        const status = extractIssueStatus(issue.labels);

        if (priority && changes.priorityChanged) {
          await tx.query(
            `UPDATE task SET priority = $1, updated_at = $2 WHERE id = $3 AND project_id = $4`,
            [priority, new Date(), lockedLink.taskId, integration.projectId],
          );
        }

        if (status && changes.statusChanged) {
          const statusResult = await updateTaskStatus(
            tx,
            lockedLink.taskId,
            status,
          );
          if (
            statusResult.applied &&
            statusResult.before.status !== statusResult.after.status
          ) {
            const { before, after } = statusResult;
            afterCommit(() =>
              deps.events.publish("task.status_changed", {
                taskId: after.id,
                projectId: after.projectId,
                userId: null,
                oldStatus: before.status,
                newStatus: after.status,
                title: after.title,
                assigneeId: after.userId,
                type: "status_changed",
              }),
            );
          }
        }

        if (
          !addedLabel ||
          addedLabel.name.startsWith("priority:") ||
          addedLabel.name.startsWith("status:")
        ) {
          if (priority) taskUpdated();
          return;
        }

        if (payload.action === "labeled") {
          const task = await findLinkedTask(
            tx,
            lockedLink.taskId,
            integration.projectId,
          );
          const project =
            task &&
            (await tx.findOne(ProjectEntity, { where: { id: task.projectId } }));
          if (task && project?.workspaceId) {
            const existingLabel = await tx.findOne(LabelEntity, {
              where: {
                workspaceId: project.workspaceId,
                name: addedLabel.name,
                taskId: task.id,
              },
            });
            if (!existingLabel) {
              await insertReturning(
                tx,
                LabelEntity,
                {
                  name: addedLabel.name,
                  color: addedLabel.color ? `#${addedLabel.color}` : "#6B7280",
                  taskId: task.id,
                  workspaceId: project.workspaceId,
                },
                { onConflict: { target: ["taskId", "name"] } },
              );
            }
          }
        }

        if (payload.action === "unlabeled") {
          await tx.query(`DELETE FROM label WHERE task_id = $1 AND name = $2`, [
            lockedLink.taskId,
            addedLabel.name,
          ]);
        }

        afterCommit(() =>
          deps.events.publish("task.labels_updated", {
            projectId: integration.projectId,
            taskId: lockedLink.taskId,
          }),
        );
      },
    );
  }
}
