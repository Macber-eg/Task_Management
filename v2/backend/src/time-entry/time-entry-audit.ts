import type { EntityManager } from "typeorm";
import { insertReturning } from "../database/dml";
import { TimeEntryAuditEntity } from "../database/entities/time-entry-audit.entity";

/** Keeps the entry as it was before and after an update or deletion. */
export async function recordTimeEntryAudit(
  manager: EntityManager,
  {
    timeEntryId,
    taskId,
    actorUserId,
    action,
    beforeData,
    afterData,
  }: {
    timeEntryId: string;
    taskId: string;
    actorUserId: string;
    action: string;
    beforeData?: unknown;
    afterData?: unknown;
  },
) {
  await insertReturning(manager, TimeEntryAuditEntity, {
    timeEntryId,
    taskId,
    actorUserId,
    action,
    beforeData: beforeData ?? null,
    afterData: afterData ?? null,
  });
}
