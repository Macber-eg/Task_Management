import type { EntityManager } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { insertReturning, updateReturning } from "../../database/dml";
import { TaskEntity } from "../../database/entities/task.entity";
import type { TaskRow } from "./task-row";

export async function insertTask(
  tx: EntityManager,
  values: Partial<TaskEntity> & { projectId: string; title: string },
): Promise<TaskRow | undefined> {
  return insertReturning(tx, TaskEntity, values);
}

/** Updates one task (stamping `updatedAt`) and returns it as stored. */
export async function updateTask(
  tx: EntityManager,
  id: string,
  set: QueryDeepPartialEntity<TaskEntity>,
  where: { projectId?: string } = {},
): Promise<TaskRow | undefined> {
  const [task] = await updateReturning(tx, TaskEntity, set, { id, ...where });
  return task;
}
