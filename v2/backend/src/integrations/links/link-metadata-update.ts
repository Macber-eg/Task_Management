import { randomUUID } from "node:crypto";
import { type IssueField, parseDeferredIssueEdit } from "./deferred-issue-edit";
import { mergeSyncMetadata } from "./merge-sync-metadata";
import {
  outboundStamp,
  type SyncStamp,
  uncertainOutboundIntents,
} from "./sync-echo";

export type LinkMetadata = Record<string, unknown> & {
  lastSync?: Record<string, SyncStamp>;
};

/** The sync-state changes `updateExternalLink` can apply to a link. */
export type LinkMetadataChanges = {
  deferredEdit?: {
    fields: IssueField[];
    repairFields?: IssueField[];
    scope: string;
  };
  completeDeferredEdit?: string;
  retireUncertainOutbound?: IssueField;
  retireOutboundIntents?: { field: IssueField; intentIds: string[] };
  outbound?: {
    field: IssueField;
    value: string;
    updatedAt?: string;
    intentId?: string;
    pending?: boolean;
    cancelled?: boolean;
    uncertain?: boolean;
  };
  observedOutbound?: {
    field: IssueField;
    intentId: string;
    updatedAt: string;
  };
  metadata?: Record<string, unknown>;
};

export function hasMetadataChanges(params: LinkMetadataChanges): boolean {
  return !!(
    params.outbound ||
    params.metadata ||
    params.observedOutbound ||
    params.deferredEdit ||
    params.completeDeferredEdit ||
    params.retireOutboundIntents ||
    params.retireUncertainOutbound
  );
}

/** The link's next metadata, from its current (locked) metadata. */
export function applyLinkMetadataChanges(
  metadata: LinkMetadata,
  params: LinkMetadataChanges,
): LinkMetadata {
  const merged = mergeSyncMetadata(metadata, params.metadata ?? {});
  // Ordinary sync metadata cannot resurrect or clear a scheduler job.
  delete merged.deferredIssueEdit;
  if (metadata.deferredIssueEdit)
    merged.deferredIssueEdit = metadata.deferredIssueEdit;
  const previousJob = parseDeferredIssueEdit(metadata.deferredIssueEdit);
  if (params.completeDeferredEdit === previousJob?.id)
    delete merged.deferredIssueEdit;
  if (params.deferredEdit) {
    const { fields, repairFields = [], scope } = params.deferredEdit;
    // The last queued direction for each field supersedes its older intent.
    const repairs = [
      ...new Set([
        ...(previousJob?.scope === scope
          ? (previousJob.repairFields ?? []).filter(
              (field) => !fields.includes(field),
            )
          : []),
        ...repairFields,
      ]),
    ];
    merged.deferredIssueEdit = {
      id: randomUUID(),
      scope,
      ...(repairs.length ? { repairFields: repairs } : {}),
      fields: [
        ...new Set([
          ...(previousJob?.scope === scope
            ? previousJob.fields.filter(
                (field) => !repairFields.includes(field),
              )
            : []),
          ...fields,
        ]),
      ],
    };
  }
  if (params.observedOutbound) {
    const { field, intentId, updatedAt } = params.observedOutbound;
    const stamp = merged.lastSync?.[field];
    if (stamp)
      stamp.outbound = stamp.outbound?.map((entry) =>
        entry.intentId === intentId
          ? {
              ...entry,
              observedUpdatedAt:
                !entry.observedUpdatedAt || updatedAt > entry.observedUpdatedAt
                  ? updatedAt
                  : entry.observedUpdatedAt,
            }
          : entry,
      );
  }
  if (params.retireOutboundIntents) {
    const { field, intentIds } = params.retireOutboundIntents;
    const ids = new Set(intentIds);
    const stamp = merged.lastSync?.[field];
    if (stamp)
      stamp.outbound = stamp.outbound?.map((entry) =>
        entry.intentId && ids.has(entry.intentId)
          ? { ...entry, pending: false, uncertain: false, cancelled: true }
          : entry,
      );
  }
  if (params.retireUncertainOutbound) {
    const stamp = merged.lastSync?.[params.retireUncertainOutbound];
    const settled = new Set(uncertainOutboundIntents(stamp));
    if (stamp)
      stamp.outbound = stamp.outbound?.map((entry) =>
        settled.has(entry)
          ? { ...entry, pending: false, uncertain: false, cancelled: true }
          : entry,
      );
  }
  if (params.outbound) {
    const { field, value, updatedAt, ...intent } = params.outbound;
    merged.lastSync = {
      ...merged.lastSync,
      [field]: outboundStamp(merged.lastSync?.[field], value, updatedAt, intent),
    };
  }
  return merged;
}
