import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { TaskEntity } from "../../../src/database/entities/task.entity";

/**
 * Inserts many tasks in one statement and returns their ids in the given
 * order. Unset columns take the table's defaults.
 */
export async function insertTasks(
  db: EntityManager,
  rows: (Partial<TaskEntity> & { projectId: string; title: string })[],
): Promise<{ id: string }[]> {
  const values = rows.map((row) => ({ id: createId(), ...row }));
  await db
    .createQueryBuilder()
    .insert()
    .into(TaskEntity)
    .values(values as QueryDeepPartialEntity<TaskEntity>[])
    .updateEntity(false)
    .execute();
  return values.map(({ id }) => ({ id }));
}
