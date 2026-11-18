import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import type { PluginContext, TaskCreatedEvent } from "../core/task-events";
import { findLinkedTask } from "../links/integration-task-scope";
import { canSyncTask } from "./eligibility";
import { isIssueInitializationPending } from "./initialize-task-issue";
import { withSyncLease } from "./lease";

/**
 * Runs a provider's issue creation for a task at most once across instances
 * (a lease per integration and task), only while the task may be synced and
 * has no issue yet (or one still initializing). `create` receives the task's
 * current values.
 */
export async function withTaskSyncCreation(
  db: EntityManager,
  event: TaskCreatedEvent,
  context: PluginContext,
  create: (current: TaskCreatedEvent) => Promise<void>,
): Promise<void> {
  await withSyncLease(
    db,
    `sync-create:${context.integrationId}:${event.taskId}`,
    () => createWithLease(db, event, context, create),
  );
}

async function createWithLease(
  db: EntityManager,
  event: TaskCreatedEvent,
  context: PluginContext,
  create: (current: TaskCreatedEvent) => Promise<void>,
) {
  if (
    !(await canSyncTask(
      db,
      event.taskId,
      context.integrationId,
      JSON.stringify(context.config),
    ))
  )
    return;
  const link = await db.findOne(ExternalLinkEntity, {
    where: {
      taskId: event.taskId,
      integrationId: context.integrationId,
      resourceType: "issue",
    },
  });
  if (link && !isIssueInitializationPending(link)) return;
  const task = await findLinkedTask(db, event.taskId, context.projectId);
  if (!task || task.number === null) return;
  await create({
    taskId: task.id,
    projectId: task.projectId,
    userId: task.userId ?? "",
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    number: task.number,
  });
  await canSyncTask(db, task.id, context.integrationId);
}
