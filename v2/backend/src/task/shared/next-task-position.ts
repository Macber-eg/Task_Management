import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { MAX_TASK_POSITION } from "./task-position";

type Range = { maximum: number | null; total: number };

/**
 * Call after `claimTaskNumber` has locked the destination project in this
 * same transaction, so concurrent creates/moves cannot allocate the same
 * position.
 */
export async function nextTaskPosition(
  tx: EntityManager,
  projectId: string,
  status: string,
  columnId: string | null,
): Promise<number> {
  const scope = columnId
    ? "project_id = $1 AND column_id = $2"
    : "project_id = $1 AND status = $2";
  const parameters = [projectId, columnId ?? status];
  const [range] = (await tx.query(
    `SELECT max(position) AS maximum, count(*)::int AS total
     FROM task WHERE ${scope}`,
    parameters,
  )) as Range[];
  const maximum = Math.max(0, range?.maximum ?? 0);
  if (maximum < MAX_TASK_POSITION) return maximum + 1;

  // Repair legacy poisoned positions in SQL, preserving relative order. Merely
  // rejecting future bad values would leave existing projects unable to append.
  const total = range?.total ?? 0;
  if (total >= MAX_TASK_POSITION) {
    throw new HTTPException(409, {
      message: "Task column has reached its capacity",
    });
  }
  await tx.query(
    `WITH ranked AS (
       SELECT id, row_number() OVER (ORDER BY position, created_at, id) AS position
       FROM task WHERE ${scope}
     )
     UPDATE task SET position = ranked.position::integer
     FROM ranked WHERE task.id = ranked.id`,
    parameters,
  );
  return total + 1;
}
