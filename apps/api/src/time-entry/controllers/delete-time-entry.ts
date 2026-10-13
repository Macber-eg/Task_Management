import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";
import { recordTimeEntryAudit } from "../audit";

async function deleteTimeEntry(timeEntryId: string, actorUserId: string) {
  const [existing] = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, timeEntryId))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }

  await recordTimeEntryAudit({
    timeEntryId,
    taskId: existing.taskId,
    actorUserId,
    action: "delete",
    beforeData: existing,
  });

  await db.delete(timeEntryTable).where(eq(timeEntryTable.id, timeEntryId));

  return existing;
}

export default deleteTimeEntry;
