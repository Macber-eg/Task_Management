import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectSprintTable } from "../../database/schema";
import {
  assertPhaseInProject,
  assertSprintsEnabled,
  getProjectPlanningFlags,
} from "../assert-planning";
import { parsePlanningDate } from "../parse-planning-date";

async function createSprint({
  projectId,
  phaseId,
  name,
  goal,
  status,
  startDate,
  endDate,
}: {
  projectId: string;
  phaseId?: string | null;
  name: string;
  goal?: string | null;
  status?: "planned" | "active" | "completed";
  startDate?: string | null;
  endDate?: string | null;
}) {
  await assertSprintsEnabled(projectId);

  const flags = await getProjectPlanningFlags(projectId);
  const nextPhaseId = phaseId?.trim() || null;
  if (flags.phasesEnabled && !nextPhaseId) {
    throw new HTTPException(400, {
      message: "Sprints must belong to a phase when phases are enabled",
    });
  }
  if (nextPhaseId) {
    await assertPhaseInProject(nextPhaseId, projectId);
  }

  const trimmed = name.trim();
  if (!trimmed) {
    throw new HTTPException(400, { message: "Sprint name is required" });
  }

  const positionScope = nextPhaseId
    ? and(
        eq(projectSprintTable.projectId, projectId),
        eq(projectSprintTable.phaseId, nextPhaseId),
      )
    : eq(projectSprintTable.projectId, projectId);

  const [maxPos] = await db
    .select({
      maximum: sql<number>`coalesce(max(${projectSprintTable.position}), -1)`,
    })
    .from(projectSprintTable)
    .where(positionScope);

  const [sprint] = await db
    .insert(projectSprintTable)
    .values({
      projectId,
      phaseId: nextPhaseId,
      name: trimmed,
      goal: goal?.trim() || null,
      status: status ?? "planned",
      position: Number(maxPos?.maximum ?? -1) + 1,
      startDate: parsePlanningDate(startDate, "startDate"),
      endDate: parsePlanningDate(endDate, "endDate"),
    })
    .returning();

  if (!sprint) {
    throw new HTTPException(500, { message: "Failed to create sprint" });
  }

  return sprint;
}

export default createSprint;
