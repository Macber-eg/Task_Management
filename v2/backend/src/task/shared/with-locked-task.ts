import type { DataSource, EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { findTaskRow, type TaskRow } from "./task-row";

/**
 * Runs `mutate` in a transaction holding the task's row lock, and returns the
 * row as it was before together with what `mutate` produced.
 */
export async function withLockedTask<T>(
  dataSource: DataSource,
  id: string,
  mutate: (tx: EntityManager, before: TaskRow) => Promise<T>,
): Promise<{ before: TaskRow; after: T }> {
  return dataSource.transaction(async (tx) => {
    const before = await findTaskRow(tx, id, { lock: true });
    if (!before) throw new HTTPException(404, { message: "Task not found" });
    return { before, after: await mutate(tx, before) };
  });
}
