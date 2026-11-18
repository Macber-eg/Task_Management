import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import { canSyncTask } from "../sync/eligibility";
import { updateExternalLink } from "./external-link-writes";
import { PendingEcho } from "./inbound-echo";
import {
  type AfterCommit,
  type ExpectedBinding,
  withIntegrationTask,
} from "./integration-task-scope";

/**
 * `withIntegrationTask` plus a row lock on the link. Issue links must still
 * be syncable (`canSyncTask`) before `apply` runs and are re-checked after,
 * in the same transaction. A `PendingEcho` thrown by `apply` is returned
 * (with its observed provider version recorded) instead of rolling back.
 */
export function withIntegrationLink<T>(
  db: EntityManager,
  link: { id: string; taskId: string },
  integration: Parameters<typeof withIntegrationTask>[2],
  apply: (
    tx: EntityManager,
    afterCommit: AfterCommit,
    lockedLink: ExternalLinkEntity,
  ) => Promise<T>,
  expectedBinding?: ExpectedBinding,
): Promise<T | PendingEcho | undefined> {
  return withIntegrationTask<T | PendingEcho | undefined>(
    db,
    link.taskId,
    integration,
    async (tx, afterCommit) => {
      const lockedLink = await tx
        .createQueryBuilder(ExternalLinkEntity, "link")
        .where("link.id = :id", { id: link.id })
        .andWhere("link.task_id = :taskId", { taskId: link.taskId })
        .andWhere("link.integration_id = :integrationId", {
          integrationId: integration.id,
        })
        .setLock("pessimistic_write")
        .getOne();
      if (!lockedLink) return;
      if (
        lockedLink.resourceType === "issue" &&
        !(await canSyncTask(
          tx,
          link.taskId,
          integration.id,
          expectedBinding?.config,
        ))
      )
        return;
      try {
        const result = await apply(tx, afterCommit, lockedLink);
        // Inbound label mutations can remove the predicate that admitted this
        // callback. Commit its paused link with the mutation, before events run.
        if (lockedLink.resourceType === "issue")
          await canSyncTask(
            tx,
            link.taskId,
            integration.id,
            expectedBinding?.config,
          );
        return result;
      } catch (error) {
        if (!(error instanceof PendingEcho)) throw error;
        if (error.context && error.intentId && error.updatedAt) {
          await updateExternalLink(tx, lockedLink.id, {
            observedOutbound: {
              field: error.context.field,
              intentId: error.intentId,
              updatedAt: error.updatedAt,
            },
          });
          error.recorded = true;
        }
        return error;
      }
    },
    expectedBinding,
  );
}
