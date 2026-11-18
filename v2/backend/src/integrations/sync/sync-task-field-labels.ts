import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import type { IssueAccess } from "../core/issue-access";
import type { PluginContext } from "../core/task-events";
import { updateExternalLink } from "../links/external-link-writes";
import { findLinkedTask } from "../links/integration-task-scope";
import { parseLinkMetadata } from "../links/parse-link-metadata";
import { createIssueWrite } from "./dispatch-issue-write";
import { canSyncTask } from "./eligibility";
import type { IssueWrite } from "./issue-write";
import { taskIssueLabels } from "./issue-labels";
import { withSyncLease } from "./lease";

const logger = new Logger("IssueFieldLabels");

/**
 * Brings an issue's `priority:`/`status:` labels (or, for "initialization",
 * all of the task's labels) in line with the task. `remote` is the provider's
 * access to this issue; `send` applies the computed add/remove through
 * `write`. Repeats until the task did not change during the provider call.
 * Answers the synchronized value, or undefined when the task may no longer
 * be synced.
 */
export async function syncTaskFieldLabels(
  db: EntityManager,
  remote: IssueAccess,
  taskId: string,
  context: PluginContext,
  link: { id: string; externalId: string },
  field: "priority" | "status" | "initialization",
  send: (
    changes: { add: string[]; remove: string[] },
    write: IssueWrite,
  ) => Promise<void>,
): Promise<string | undefined> {
  const config = JSON.stringify(context.config);
  const prefixes =
    field === "initialization" ? ["priority:", "status:"] : [`${field}:`];
  return withSyncLease(db, `sync-field-labels:${link.id}`, async () => {
    const write = createIssueWrite(
      db,
      { ...link, taskId, integrationId: context.integrationId },
      config,
    );
    for (;;) {
      if (!(await canSyncTask(db, taskId, context.integrationId, config)))
        return;
      const task = await findLinkedTask(db, taskId, context.projectId);
      if (!task) return;
      const labels = (await remote.read()).labels;
      const add =
        field === "initialization"
          ? (await taskIssueLabels(db, taskId, task.priority, task.status)).sort()
          : field === "priority" &&
              (!task.priority || task.priority === "no-priority")
            ? []
            : [`${field}:${task[field]}`];
      const value =
        field === "initialization"
          ? JSON.stringify(add)
          : (task[field] ?? "no-priority");
      const remove = labels.filter(
        (name) =>
          prefixes.some((prefix) => name.startsWith(prefix)) &&
          !add.includes(name),
      );
      await send({ add, remove }, write);
      if (!(await canSyncTask(db, taskId, context.integrationId, config)))
        return;
      const stored = await db.findOne(ExternalLinkEntity, {
        where: { id: link.id, integrationId: context.integrationId },
      });
      if (!stored) return;
      const metadata = parseLinkMetadata<{
        syncResumeLabelBaseline?: string[];
      }>(stored.metadata, {
        externalLinkId: link.id,
        source: "outbound_field_labels",
      });
      if (Array.isArray(metadata.syncResumeLabelBaseline))
        await updateExternalLink(db, link.id, {
          metadata: {
            syncResumeLabelBaseline: [
              ...new Set([
                ...metadata.syncResumeLabelBaseline.filter(
                  (name) =>
                    typeof name === "string" &&
                    !prefixes.some((prefix) => name.startsWith(prefix)),
                ),
                ...add,
              ]),
            ],
          },
        });
      const current = await findLinkedTask(db, taskId, context.projectId);
      if (!current) return;
      // A later event may time out waiting for this lease. The current owner
      // repairs edits made during its provider request before releasing it.
      const currentValue =
        field === "initialization"
          ? JSON.stringify(
              (
                await taskIssueLabels(
                  db,
                  taskId,
                  current.priority,
                  current.status,
                )
              ).sort(),
            )
          : (current[field] ?? "no-priority");
      if (currentValue === value) return value;
    }
  }).catch(() => {
    logger.error(
      `Issue field label synchronization failed (integration ${context.integrationId}, link ${link.id}, ${field})`,
    );
    throw new Error("Issue field label synchronization failed");
  });
}
