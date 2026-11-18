import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";

/**
 * Reserves `count` consecutive task numbers and returns the first. The update
 * also locks the project row for the rest of the transaction.
 */
export async function claimTaskNumbers(
  manager: EntityManager,
  projectId: string,
  count: number,
): Promise<number> {
  const [rows] = (await manager.query(
    `UPDATE project SET last_task_number = last_task_number + $2
     WHERE id = $1 RETURNING last_task_number AS "lastTaskNumber"`,
    [projectId, count],
  )) as [{ lastTaskNumber: number }[], number];
  const updated = rows[0];

  if (!updated) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  return updated.lastTaskNumber - count + 1;
}

export function claimTaskNumber(manager: EntityManager, projectId: string) {
  return claimTaskNumbers(manager, projectId, 1);
}
