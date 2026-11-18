import type { EntityManager } from "typeorm";

/** The phase a sprint is planned in; undefined when the sprint is gone. */
export async function findSprintPhaseId(
  manager: EntityManager,
  sprintId: string,
): Promise<string | null | undefined> {
  const [sprint] = (await manager.query(
    `SELECT phase_id AS "phaseId" FROM project_sprint WHERE id = $1 LIMIT 1`,
    [sprintId],
  )) as { phaseId: string | null }[];
  return sprint?.phaseId;
}
