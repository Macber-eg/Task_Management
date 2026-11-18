import type { EntityManager } from "typeorm";
import type { EventBus } from "../../events/event-bus";
import { updateExternalLink } from "./external-link-writes";
import {
  type ExpectedBinding,
  integrationTaskRevision,
} from "./integration-task-scope";
import { parseLinkMetadata } from "./parse-link-metadata";
import {
  hasNewerObservedEdit,
  inboundStamp,
  type SyncStamp,
} from "./sync-echo";
import { withIntegrationLink } from "./with-integration-link";
import { writeInboundTaskField } from "./write-inbound-task-field";

/**
 * Applies a provider edit observed while our own write was in flight, once
 * the task is unchanged since `expectedRevision`. Answers true when applied,
 * false when the task changed meanwhile.
 */
// The observed matching value is durable even if the inbound HTTP request
// times out waiting for our response. Apply it only after version correlation.
export async function applyObservedTaskValue(
  db: EntityManager,
  events: EventBus,
  link: { id: string; taskId: string },
  integration: { id: string; projectId: string; type: string },
  field: "title" | "description" | "state",
  value: string,
  intentId: string,
  updatedAt: string | undefined,
  expectedRevision: string,
  expectedBinding?: ExpectedBinding,
) {
  return withIntegrationLink(
    db,
    link,
    integration,
    async (tx, afterCommit, locked) => {
      const metadata = parseLinkMetadata<
        Record<string, unknown> & { lastSync?: Record<string, SyncStamp> }
      >(locked.metadata, {
        externalLinkId: link.id,
        source: "observed_provider_edit",
      });
      const stamp = metadata.lastSync?.[field];
      if (
        (await integrationTaskRevision(
          tx,
          link.taskId,
          integration.projectId,
        )) !== expectedRevision
      )
        return false;
      if (
        !hasNewerObservedEdit(
          stamp?.outbound?.find((entry) => entry.intentId === intentId),
          updatedAt,
        )
      )
        return;
      await writeInboundTaskField(
        tx,
        events,
        afterCommit,
        link,
        integration,
        field,
        value,
      );
      await updateExternalLink(tx, link.id, {
        metadata: {
          ...metadata,
          ...(field === "state" ? { state: value } : {}),
          lastSync: {
            ...metadata.lastSync,
            [field]: inboundStamp(
              stamp,
              value,
              integration.type,
              stamp?.outbound?.find((entry) => entry.intentId === intentId)
                ?.observedUpdatedAt,
            ),
          },
        },
      });
      afterCommit(() =>
        events.publish("task.updated", {
          taskId: link.taskId,
          projectId: integration.projectId,
          ...(field === "title" ? { titleChanged: true } : {}),
        }),
      );
      return true;
    },
    expectedBinding,
  );
}
