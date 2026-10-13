import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

type Db = typeof db | NodePgDatabase<typeof schema>;

export async function getProjectPlanningFlags(projectId: string, tx: Db = db) {
  const [project] = await tx
    .select({
      phasesEnabled: schema.projectTable.phasesEnabled,
      sprintsEnabled: schema.projectTable.sprintsEnabled,
    })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return project;
}

export async function assertPhasesEnabled(projectId: string, tx: Db = db) {
  const flags = await getProjectPlanningFlags(projectId, tx);
  if (!flags.phasesEnabled) {
    throw new HTTPException(403, {
      message: "Phases are not enabled for this project",
    });
  }
}

export async function assertSprintsEnabled(projectId: string, tx: Db = db) {
  const flags = await getProjectPlanningFlags(projectId, tx);
  if (!flags.sprintsEnabled) {
    throw new HTTPException(403, {
      message: "Sprints are not enabled for this project",
    });
  }
}

export async function assertPhaseInProject(
  phaseId: string,
  projectId: string,
  tx: Db = db,
) {
  const [phase] = await tx
    .select({ id: schema.projectPhaseTable.id })
    .from(schema.projectPhaseTable)
    .where(
      and(
        eq(schema.projectPhaseTable.id, phaseId),
        eq(schema.projectPhaseTable.projectId, projectId),
      ),
    )
    .limit(1);

  if (!phase) {
    throw new HTTPException(400, {
      message: "Phase does not belong to this project",
    });
  }
}

export async function assertSprintInProject(
  sprintId: string,
  projectId: string,
  tx: Db = db,
) {
  const [sprint] = await tx
    .select({ id: schema.projectSprintTable.id })
    .from(schema.projectSprintTable)
    .where(
      and(
        eq(schema.projectSprintTable.id, sprintId),
        eq(schema.projectSprintTable.projectId, projectId),
      ),
    )
    .limit(1);

  if (!sprint) {
    throw new HTTPException(400, {
      message: "Sprint does not belong to this project",
    });
  }
}
