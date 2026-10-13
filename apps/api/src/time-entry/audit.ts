import { createId } from "@paralleldrive/cuid2";
import db from "../database";
import { timeEntryAuditTable } from "../database/schema";

export async function recordTimeEntryAudit({
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
}) {
  await db.insert(timeEntryAuditTable).values({
    id: createId(),
    timeEntryId,
    taskId,
    actorUserId,
    action,
    beforeData: beforeData ?? null,
    afterData: afterData ?? null,
  });
}
