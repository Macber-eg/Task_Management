import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { EventBus } from "../../events/event-bus";
import type { PluginContext, TaskCreatedEvent } from "../core/task-events";
import { updateExternalLink } from "../links/external-link-writes";
import { isTaskInFinalState } from "../links/integration-tasks";
import { parseLinkMetadata } from "../links/parse-link-metadata";
import type { SyncStamp } from "../links/sync-echo";
import { syncLatestTaskValue } from "../links/sync-latest-task-value";

const logger = new Logger("IssueInitialization");

/** Closes the new issue when the task is already complete (once per link). */
export async function initializeTaskState(
  db: EntityManager,
  events: EventBus,
  event: TaskCreatedEvent,
  context: PluginContext,
  link: { id: string; metadata?: string | null },
  send: (value: string) => Promise<string | undefined>,
): Promise<void> {
  const progress = parseLinkMetadata<{
    state?: string;
    lastSync?: { state?: SyncStamp };
    syncInitializedState?: boolean;
  }>(link.metadata, { externalLinkId: link.id, source: "sync_initialization" });
  if (progress.syncInitializedState) return;
  const closing = await isTaskInFinalState(db, {
    projectId: event.projectId,
    status: event.status,
    columnId: null,
  });
  // Retried closes may have reached the provider even when their response failed.
  if (
    closing ||
    progress.state === "closed" ||
    progress.lastSync?.state?.outbound?.length
  ) {
    try {
      const synchronized = await syncLatestTaskValue(
        db,
        events,
        event.taskId,
        event.projectId,
        { id: link.id, integrationId: context.integrationId },
        "state",
        closing ? "closed" : "open",
        send,
        undefined,
        { config: JSON.stringify(context.config) },
      );
      if (!synchronized) throw new Error("Issue state needs retry");
    } catch {
      logger.error(
        `Issue state initialization failed (project ${event.projectId}, task ${event.taskId}, integration ${context.integrationId}, link ${link.id})`,
      );
      throw new Error("Issue state initialization incomplete");
    }
  }
  await updateExternalLink(db, link.id, {
    metadata: { syncInitializedState: true },
  });
}
