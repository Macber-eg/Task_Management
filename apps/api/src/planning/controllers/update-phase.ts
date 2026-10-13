import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectPhaseTable } from "../../database/schema";
import { parsePlanningDate } from "../parse-planning-date";
import { assertValidPhaseParent } from "../phase-parent";

async function updatePhase(
  id: string,
  body: {
    name?: string;
    parentId?: string | null;
    kind?: "folder" | "document";
    position?: number;
    startDate?: string | null;
    endDate?: string | null;
    archived?: boolean;
  },
) {
  const [existing] = await db
    .select()
    .from(projectPhaseTable)
    .where(eq(projectPhaseTable.id, id))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Phase not found" });
  }

  const updates: Partial<typeof projectPhaseTable.$inferInsert> = {};

  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) {
      throw new HTTPException(400, { message: "Phase name is required" });
    }
    updates.name = trimmed;
  }
  if (body.startDate !== undefined) {
    updates.startDate = parsePlanningDate(body.startDate, "startDate");
  }
  if (body.endDate !== undefined) {
    updates.endDate = parsePlanningDate(body.endDate, "endDate");
  }
  if (body.parentId !== undefined) {
    const resolvedParentId = body.parentId === "" ? null : body.parentId;
    await assertValidPhaseParent({
      projectId: existing.projectId,
      parentId: resolvedParentId,
      phaseId: id,
    });
    updates.parentId = resolvedParentId;
  }
  if (body.kind !== undefined) {
    updates.kind = body.kind;
  }
  if (body.position !== undefined) {
    updates.position = body.position;
  }
  if (body.archived !== undefined) {
    updates.archivedAt = body.archived ? new Date() : null;
  }

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  const [phase] = await db
    .update(projectPhaseTable)
    .set(updates)
    .where(eq(projectPhaseTable.id, id))
    .returning();

  if (!phase) {
    throw new HTTPException(500, { message: "Failed to update phase" });
  }

  return phase;
}

export default updatePhase;
