import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectSprintTable } from "../../database/schema";
import { assertPhaseInProject } from "../assert-planning";
import { parsePlanningDate } from "../parse-planning-date";

async function updateSprint(
  id: string,
  body: {
    name?: string;
    phaseId?: string | null;
    goal?: string | null;
    status?: "planned" | "active" | "completed";
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  const [existing] = await db
    .select()
    .from(projectSprintTable)
    .where(eq(projectSprintTable.id, id))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Sprint not found" });
  }

  const updates: Partial<typeof projectSprintTable.$inferInsert> = {};

  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) {
      throw new HTTPException(400, { message: "Sprint name is required" });
    }
    updates.name = trimmed;
  }
  if (body.goal !== undefined) {
    updates.goal = body.goal?.trim() || null;
  }
  if (body.phaseId !== undefined) {
    const nextPhaseId = body.phaseId?.trim() || null;
    if (nextPhaseId) {
      await assertPhaseInProject(nextPhaseId, existing.projectId);
    }
    updates.phaseId = nextPhaseId;
  }
  if (body.status !== undefined) {
    updates.status = body.status;
  }
  if (body.startDate !== undefined) {
    updates.startDate = parsePlanningDate(body.startDate, "startDate");
  }
  if (body.endDate !== undefined) {
    updates.endDate = parsePlanningDate(body.endDate, "endDate");
  }

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  const [sprint] = await db
    .update(projectSprintTable)
    .set(updates)
    .where(eq(projectSprintTable.id, id))
    .returning();

  if (!sprint) {
    throw new HTTPException(500, { message: "Failed to update sprint" });
  }

  return sprint;
}

export default updateSprint;
