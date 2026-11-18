import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import type { EventBus } from "../../events/event-bus";
import { dispatchIssueWrite } from "../sync/dispatch-issue-write";
import { canSyncTask } from "../sync/eligibility";
import { applyObservedTaskValue } from "./apply-observed-task-value";
import { deferTaskSync } from "./defer-issue-edit";
import { issueEditScope, parseDeferredIssueEdit } from "./deferred-issue-edit";
import { findExternalLinksByTask } from "./external-link-queries";
import { updateExternalLink } from "./external-link-writes";
import {
  findLinkedTask,
  integrationTaskRevision,
} from "./integration-task-scope";
import { isTaskInFinalState } from "./integration-tasks";
import { parseLinkMetadata } from "./parse-link-metadata";
import { hasNewerObservedEdit, type SyncStamp } from "./sync-echo";

/**
 * Writes a task field to its linked issue through `write` (which answers the
 * provider's `updated_at`), records the outbound intent for echo detection,
 * and repeats with the task's current value until the provider holds it (at
 * most three writes, then a deferred repair). Answers true when synchronized,
 * undefined when the link or binding changed and nothing more should be sent.
 */
// Provider requests may complete out of order across API instances. Every late
// completion repairs the provider using the current, still-linked task value.
export async function syncLatestTaskValue(
  db: EntityManager,
  events: EventBus,
  taskId: string,
  projectId: string,
  link: { id: string; integrationId: string | null },
  field: "title" | "description" | "state",
  initialValue: string,
  write: (value: string) => Promise<string | undefined>,
  readCurrent?: () => Promise<string>,
  expectedBinding?: { type?: string; config?: string },
  repair = false,
): Promise<true | undefined> {
  let value = initialValue;
  let attempts = 0;
  let identity = expectedBinding;
  let lastIntentId: string | undefined;
  const currentBinding = async () => {
    const binding = (await findExternalLinksByTask(db, taskId)).find(
      (candidate) =>
        candidate.id === link.id &&
        candidate.integrationId === link.integrationId &&
        candidate.resourceType === "issue",
    );
    if (
      !binding ||
      (binding.integration &&
        (binding.integration.isActive === false ||
          binding.integration.projectId !== projectId ||
          (identity?.type !== undefined &&
            binding.integration.type !== identity.type) ||
          (identity?.config !== undefined &&
            binding.integration.config !== identity.config)))
    ) {
      // The old request cannot identify deliveries from the retained new binding.
      // Retire only its UUID, preserving newer intents and current field metadata.
      if (lastIntentId)
        await updateExternalLink(db, link.id, {
          retireOutboundIntents: { field, intentIds: [lastIntentId] },
        });
      return;
    }
    if (
      !(await canSyncTask(
        db,
        taskId,
        link.integrationId ?? "",
        identity?.config,
      ))
    )
      return;
    return binding;
  };
  for (;;) {
    const binding = await currentBinding();
    if (!binding) return;
    identity ??= binding.integration
      ? { type: binding.integration.type, config: binding.integration.config }
      : undefined;
    const queued = parseDeferredIssueEdit(
      parseLinkMetadata<{ deferredIssueEdit?: unknown }>(binding.metadata, {
        externalLinkId: link.id,
        source: "outbound_repair",
      }).deferredIssueEdit,
    );
    const repairing =
      repair ||
      !!(
        queued?.repairFields?.includes(field) &&
        binding.integration &&
        issueEditScope(binding.integration) === queued.scope
      );
    const intentId = randomUUID();
    lastIntentId = intentId;
    // Webhooks may arrive before PATCH returns, including from another instance.
    const persisted = await updateExternalLink(db, link.id, {
      outbound: { field, value, intentId, pending: true },
    });
    if (persisted === false || !(await currentBinding())) return;
    let updatedAt: string | undefined;
    try {
      const dispatched = await dispatchIssueWrite(
        db,
        { ...link, taskId },
        identity?.config,
        () => write(value),
      );
      if (!dispatched) {
        await updateExternalLink(db, link.id, {
          outbound: {
            field,
            value,
            intentId,
            pending: false,
            cancelled: true,
            uncertain: false,
          },
        });
        return;
      }
      updatedAt = dispatched.value;
      attempts++;
    } catch (error) {
      const status =
        typeof error === "object" && error && "status" in error
          ? Number(error.status)
          : undefined;
      const rejected =
        status !== undefined && status >= 400 && status < 500 && status !== 408;
      await updateExternalLink(db, link.id, {
        outbound: {
          field,
          value,
          intentId,
          pending: false,
          cancelled: rejected,
          uncertain: !rejected,
        },
      }).catch(() => {});
      if (!rejected && binding.integration?.config && (await currentBinding()))
        await deferTaskSync(db, { id: link.id, taskId }, binding.integration, [
          field,
        ]).catch(() => {});
      throw error;
    }
    if (!(await currentBinding())) return;
    await updateExternalLink(db, link.id, {
      ...(field === "title" ? { title: value } : {}),
      outbound: { field, value, updatedAt, intentId, pending: false },
      ...(repairing ? { retireUncertainOutbound: field } : {}),
      ...(field === "state"
        ? { metadata: { state: value, lastOutboundStateSyncAt: Date.now() } }
        : {}),
    });
    const currentLink = await currentBinding();
    if (!currentLink) return;
    const metadata = parseLinkMetadata<{
      lastSync?: Record<string, SyncStamp>;
    }>(currentLink.metadata, {
      externalLinkId: link.id,
      source: "outbound_completion",
    });
    const observed = metadata.lastSync?.[field]?.outbound?.find(
      (entry) => entry.intentId === intentId,
    );
    // The waiting inbound handler applies this newer provider edit after the
    // exact response version is available; do not overwrite it with a repair.
    if (
      hasNewerObservedEdit(observed, updatedAt) &&
      currentLink.integration &&
      readCurrent
    ) {
      const revision = await integrationTaskRevision(db, taskId, projectId);
      if (!(await currentBinding())) return;
      if (
        revision &&
        (await readCurrent()) === value &&
        (await applyObservedTaskValue(
          db,
          events,
          currentLink,
          currentLink.integration,
          field,
          value,
          intentId,
          updatedAt,
          revision,
          identity,
        )) === true
      )
        return true;
    }
    const task = await findLinkedTask(db, taskId, projectId);
    if (!task) return;
    const current =
      field === "state"
        ? (await isTaskInFinalState(db, task))
          ? "closed"
          : "open"
        : field === "title"
          ? task.title
          : task.description || "";
    if (current === value) return true;
    if (attempts >= 3) {
      if (binding.integration)
        await deferTaskSync(db, { id: link.id, taskId }, binding.integration, [
          field,
        ]);
      return;
    }
    value = current;
  }
}
