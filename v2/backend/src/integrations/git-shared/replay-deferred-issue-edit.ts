import type { EntityManager } from "typeorm";
import type { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import type { IntegrationEntity } from "../../database/entities/integration.entity";
import type { EventBus } from "../../events/event-bus";
import {
  type IssueField,
  issueEditScope,
  parseDeferredIssueEdit,
} from "../links/deferred-issue-edit";
import { updateExternalLink } from "../links/external-link-writes";
import { inboundEcho } from "../links/inbound-echo";
import {
  findLinkedTask,
  integrationTaskRevision,
} from "../links/integration-task-scope";
import { isTaskInFinalState } from "../links/integration-tasks";
import { formatTaskDescriptionFromIssue } from "../links/issue-format";
import { parseLinkMetadata } from "../links/parse-link-metadata";
import {
  inboundOccurredAfterIntent,
  inboundStamp,
  type SyncStamp,
  uncertainOutboundIntents,
} from "../links/sync-echo";
import { syncLatestTaskValue } from "../links/sync-latest-task-value";
import { withIntegrationLink } from "../links/with-integration-link";
import { writeInboundTaskField } from "../links/write-inbound-task-field";
import { canSyncTask } from "../sync/eligibility";
import type {
  DeferredEditAccess,
  DeferredEditIssue,
  DeferredIssueEditProviders,
} from "./deferred-issue-edit-providers";

type Metadata = Record<string, unknown> & {
  lastSync?: Record<string, SyncStamp>;
};
type Repair = { field: IssueField; value: string; intentIds: string[] };

const metadataFor = (link: { id: string; metadata: string | null }) =>
  parseLinkMetadata<Metadata>(link.metadata, {
    externalLinkId: link.id,
    source: "deferred_issue_edit",
  });

const isNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

/**
 * Replays one link's deferred job: applies the queued inbound fields the
 * provider still holds (unless they are our own echoes) and repairs the
 * provider where an uncertain outbound write left it behind the task. Throws
 * `PendingEcho` while an outbound write of the link is still settling.
 */
export async function replayDeferredIssueEdit(
  db: EntityManager,
  events: EventBus,
  providers: DeferredIssueEditProviders,
  link: ExternalLinkEntity,
): Promise<void> {
  const metadata = metadataFor(link);
  const job = parseDeferredIssueEdit(metadata.deferredIssueEdit);
  if (!job) return;
  const integration = link.integration;
  const open = integration ? providers.get(integration.type) : undefined;
  if (
    !integration?.isActive ||
    !open ||
    issueEditScope(integration) !== job.scope
  ) {
    await updateExternalLink(db, link.id, { completeDeferredEdit: job.id });
    return;
  }
  const scope: IntegrationEntity = integration;
  if (!(await canSyncTask(db, link.taskId, scope.id, scope.config))) return;
  const fields = [...new Set([...job.fields, ...(job.repairFields ?? [])])];
  // An orphaned writer expires after five minutes; until then let it settle.
  if (
    fields.some((field) =>
      metadata.lastSync?.[field]?.outbound?.some(
        (entry) =>
          entry.pending &&
          !entry.cancelled &&
          Date.now() - Date.parse(entry.timestamp) < 300_000,
      ),
    )
  )
    return;
  const revision = await integrationTaskRevision(
    db,
    link.taskId,
    scope.projectId,
  );
  if (!revision) return;
  const provider = await open(scope, link);
  let issue: DeferredEditIssue;
  try {
    issue = await provider.read();
  } catch (error) {
    if (!isNotFound(error)) throw error;
    // Only retire this read's job; credentials, binding, or queued fields
    // may have changed while the provider request was in flight.
    await withIntegrationLink(
      db,
      link,
      scope,
      async (tx) => {
        await updateExternalLink(tx, link.id, { completeDeferredEdit: job.id });
      },
      scope,
    );
    return;
  }
  if (
    typeof issue.title !== "string" ||
    !["open", "closed"].includes(issue.state)
  )
    throw new Error("Invalid issue response");
  const values: Record<IssueField, string> = {
    title: issue.title,
    description: formatTaskDescriptionFromIssue(
      issue.body ?? null,
      link.taskId,
    ),
    state: issue.state,
  };
  const repairs: Repair[] = [];
  const applied = await withIntegrationLink(
    db,
    link,
    scope,
    async (tx, afterCommit, locked) => {
      const current = metadataFor(locked);
      if (parseDeferredIssueEdit(current.deferredIssueEdit)?.id !== job.id)
        return;
      if (
        fields.some(
          (field) =>
            JSON.stringify(current.lastSync?.[field]) !==
            JSON.stringify(metadata.lastSync?.[field]),
        )
      )
        return;
      if (
        (await integrationTaskRevision(tx, link.taskId, scope.projectId)) !==
        revision
      )
        return;
      const task = await findLinkedTask(tx, link.taskId, scope.projectId);
      if (!task) return;
      const taskIsClosed = fields.includes("state")
        ? await isTaskInFinalState(tx, task)
        : false;
      const localValue = (field: IssueField) =>
        field === "state"
          ? taskIsClosed
            ? "closed"
            : "open"
          : field === "description"
            ? task.description || ""
            : task.title;
      for (const field of fields) {
        const stamp = current.lastSync?.[field];
        const uncertain = uncertainOutboundIntents(stamp, values[field]);
        const intentIds = uncertain.flatMap((entry) =>
          entry.intentId ? [entry.intentId] : [],
        );
        const local = localValue(field);
        if (job.repairFields?.includes(field) && !job.fields.includes(field)) {
          repairs.push({ field, value: local, intentIds });
          continue;
        }
        // A crashed older writer can leave the provider behind our completed
        // local value. Its missing receipt does not make it a remote edit.
        if (
          local !== values[field] &&
          uncertain.some(
            (entry) =>
              !(
                stamp?.source !== "kaneo" &&
                stamp?.inboundValue === local &&
                inboundOccurredAfterIntent(stamp, entry)
              ),
          )
        ) {
          repairs.push({ field, value: local, intentIds });
        }
      }
      // Classify every field before writing any: PendingEcho commits only its observation.
      const accepted = job.fields.filter(
        (field) =>
          !repairs.some((repair) => repair.field === field) &&
          !(
            field === "state" &&
            scope.type === "github" &&
            current.createdFrom === "kaneo"
          ) &&
          !inboundEcho(
            current.lastSync?.[field],
            values[field],
            issue.updated_at,
            values[field],
            { linkId: link.id, field, localValue: localValue(field) },
          ),
      );
      for (const field of accepted) {
        await writeInboundTaskField(
          tx,
          events,
          afterCommit,
          link,
          scope,
          field,
          values[field],
        );
        current.lastSync = {
          ...current.lastSync,
          [field]: inboundStamp(
            current.lastSync?.[field],
            values[field],
            scope.type,
            issue.updated_at,
          ),
        };
        if (field === "state") current.state = values.state;
      }
      await updateExternalLink(tx, link.id, {
        metadata: current,
        ...(accepted.includes("title") ? { title: values.title } : {}),
        ...(repairs.length ? {} : { completeDeferredEdit: job.id }),
      });
      if (accepted.length)
        afterCommit(() =>
          events.publish("task.updated", {
            taskId: link.taskId,
            projectId: scope.projectId,
          }),
        );
      return true;
    },
    scope,
  );
  if (applied !== true) return;
  await repairProvider(db, events, link, scope, provider, repairs, fields, job);
}

async function repairProvider(
  db: EntityManager,
  events: EventBus,
  link: ExternalLinkEntity,
  integration: IntegrationEntity,
  provider: DeferredEditAccess,
  repairs: Repair[],
  fields: IssueField[],
  job: { id: string; scope: string },
): Promise<void> {
  for (const repair of repairs) {
    await syncLatestTaskValue(
      db,
      events,
      link.taskId,
      integration.projectId,
      link,
      repair.field,
      repair.value,
      (value) => provider.write(repair.field, value),
      async () => {
        const current = await provider.read();
        if (repair.field === "description")
          return formatTaskDescriptionFromIssue(
            current.body ?? null,
            link.taskId,
          );
        return repair.field === "title" ? current.title : current.state;
      },
      integration,
      true,
    );
    // A later field can fail; persist this field's successful repair first.
    if (repair.intentIds.length)
      await withIntegrationLink(
        db,
        link,
        integration,
        async (tx) => {
          await updateExternalLink(tx, link.id, {
            retireOutboundIntents: {
              field: repair.field,
              intentIds: repair.intentIds,
            },
          });
        },
        integration,
      );
  }
  if (repairs.length)
    await withIntegrationLink(
      db,
      link,
      integration,
      async (tx, _afterCommit, locked) => {
        // Writes settled after the receipt need their own later correction.
        const current = metadataFor(locked);
        const remaining = fields.filter(
          (field) => uncertainOutboundIntents(current.lastSync?.[field]).length,
        );
        await updateExternalLink(
          tx,
          link.id,
          remaining.length
            ? {
                deferredEdit: {
                  fields: [],
                  repairFields: remaining,
                  scope: job.scope,
                },
              }
            : { completeDeferredEdit: job.id },
        );
      },
      integration,
    );
}
