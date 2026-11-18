import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import type { EventBus } from "../../events/event-bus";
import type { PluginContext, TaskCreatedEvent } from "../core/task-events";
import { updateExternalLink } from "../links/external-link-writes";
import { findLinkedTask } from "../links/integration-task-scope";
import { parseLinkMetadata } from "../links/parse-link-metadata";
import { syncLatestTaskValue } from "../links/sync-latest-task-value";
import { canSyncTask } from "./eligibility";

/**
 * First step of exporting a task to a just-created issue: writes the task's
 * current title and description when they differ from what the issue was
 * created with. Answers the task as it is now.
 */
export async function initializeTaskText(
  db: EntityManager,
  events: EventBus,
  event: TaskCreatedEvent,
  context: PluginContext,
  link: { id: string; metadata?: string | null },
  send: (
    field: "title" | "description",
    value: string,
  ) => Promise<string | undefined>,
): Promise<TaskCreatedEvent> {
  const task = await findLinkedTask(db, event.taskId, context.projectId);
  if (!task) throw new Error("Task sync scope changed");
  const stored = await db.findOne(ExternalLinkEntity, {
    where: {
      id: link.id,
      taskId: event.taskId,
      integrationId: context.integrationId,
    },
    select: { id: true, metadata: true },
  });
  if (!stored) throw new Error("Issue sync scope changed");
  const progress = parseLinkMetadata<{
    syncInitializedText?: { title: string; description: string };
    syncCreatedText?: { title: string; description: string };
  }>(stored.metadata, {
    externalLinkId: link.id,
    source: "sync_initialization",
  });
  const previous = progress.syncInitializedText ?? progress.syncCreatedText;
  const values = { title: task.title, description: task.description ?? "" };
  for (const field of ["title", "description"] as const) {
    if (previous?.[field] === values[field]) continue;
    await syncLatestTaskValue(
      db,
      events,
      task.id,
      context.projectId,
      { id: link.id, integrationId: context.integrationId },
      field,
      values[field],
      (value) => send(field, value),
      undefined,
      { config: JSON.stringify(context.config) },
    );
  }
  if (
    !(await canSyncTask(
      db,
      event.taskId,
      context.integrationId,
      JSON.stringify(context.config),
    ))
  )
    throw new Error("Issue sync scope changed");
  await updateExternalLink(db, link.id, {
    metadata: { syncInitializedText: values },
  });
  const current = await findLinkedTask(db, event.taskId, context.projectId);
  if (!current || current.number === null)
    throw new Error("Task sync scope changed");
  return {
    ...event,
    title: current.title,
    description: current.description,
    priority: current.priority,
    status: current.status,
    userId: current.userId ?? "",
    number: current.number,
  };
}
