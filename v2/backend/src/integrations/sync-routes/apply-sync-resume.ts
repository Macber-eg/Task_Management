import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { updateReturning } from "../../database/dml";
import { ColumnEntity } from "../../database/entities/column.entity";
import { TaskEntity } from "../../database/entities/task.entity";
import type {
  TaskBefore,
  TaskMutationEffects,
} from "../../task/effects/task-mutation-effects.service";
import { parseDeferredIssueEdit } from "../links/deferred-issue-edit";
import { updateExternalLink } from "../links/external-link-writes";
import { formatIssueBody } from "../links/issue-format";
import { resolveTargetStatus } from "../links/resolve-target-status";
import { inboundStamp, type SyncStamp } from "../links/sync-echo";
import type { SyncResumeReview } from "./sync-resume-review.service";

export type SyncAdoption = {
  before: TaskBefore;
  after: TaskBefore;
  integrationId: string;
};

/**
 * The local half of a resume, inside the validating transaction: adopts the
 * repository's values into the task (source "provider"), then unpauses the
 * link and records each field's sync state so echoes are recognised.
 */
export async function applySyncResume(
  tx: EntityManager,
  effects: TaskMutationEffects,
  review: SyncResumeReview,
  provider: string,
  source: "kaneo" | "provider",
  updatedAt: string | null,
): Promise<SyncAdoption | undefined> {
  const { task, link } = review;
  let adoption: SyncAdoption | undefined;
  if (source === "provider") {
    let status = { status: task.status, columnId: task.columnId };
    if (review.local.state !== review.remote.state) {
      const columns = await tx.find(ColumnEntity, {
        where: { projectId: task.projectId },
        order: { position: "ASC" },
      });
      const fallback = columns.find(
        (column) => column.isFinal === (review.remote.state === "closed"),
      );
      if (!fallback)
        throw new HTTPException(409, {
          message: "A matching open or completed column is required",
        });
      const slug = await resolveTargetStatus(
        tx,
        provider === "gitea" || provider === "gitlab" ? provider : "github",
        task.projectId,
        review.remote.state === "closed" ? "issue_closed" : "issue_reopened",
        fallback.slug,
      );
      const target = columns.find((column) => column.slug === slug)!;
      status = { status: target.slug, columnId: target.id };
    }
    const [after] = await updateReturning(
      tx,
      TaskEntity,
      {
        title: review.remote.title,
        description: review.remote.description,
        ...status,
      },
      { id: task.id },
    );
    await effects.recordTaskMutation(tx, task, after!);
    adoption = {
      before: task,
      after: after!,
      integrationId: review.integration.id,
    };
  }
  const chosen = review[source === "kaneo" ? "local" : "remote"];
  const job = parseDeferredIssueEdit(
    JSON.parse(link.metadata ?? "{}").deferredIssueEdit,
  );
  for (const field of ["title", "description", "state"] as const) {
    await updateExternalLink(tx, link.id, {
      ...(field === "title" ? { title: chosen.title } : {}),
      ...(source === "kaneo" && provider !== "gitlab"
        ? {
            outbound: {
              field,
              value: review.local[field],
              intentId: randomUUID(),
              updatedAt: updatedAt ?? undefined,
              pending: false,
            },
          }
        : {}),
      ...(job ? { completeDeferredEdit: job.id } : {}),
      metadata: {
        syncFilterPaused: false,
        syncResumeUncertain: false,
        syncResumeLabelBaseline: review.remoteIssueLabels,
        ...(provider === "gitlab"
          ? {
              lastOutboundStateSyncAt: Date.now(),
              lastSync: {
                title: {
                  source: source === "kaneo" ? "kaneo" : "gitlab",
                  value: chosen.title,
                  timestamp: new Date().toISOString(),
                },
                description: {
                  source: source === "kaneo" ? "kaneo" : "gitlab",
                  value:
                    source === "kaneo"
                      ? formatIssueBody(review.local.description, task.id)
                      : review.remote.description,
                  timestamp: new Date().toISOString(),
                },
              },
            }
          : {}),
        ...(source === "provider" && provider !== "gitlab"
          ? {
              lastSync: {
                [field]: inboundStamp(
                  (
                    JSON.parse(link.metadata ?? "{}").lastSync as
                      | Record<string, SyncStamp>
                      | undefined
                  )?.[field],
                  review.remote[field],
                  provider,
                  review.remoteIssueUpdatedAt ?? undefined,
                ),
              },
            }
          : {}),
        state:
          provider === "gitlab" && chosen.state === "open"
            ? "opened"
            : chosen.state,
      },
      retireUncertainOutbound: field,
    });
  }
  return adoption;
}
