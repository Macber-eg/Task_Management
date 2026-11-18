import type { EntityManager } from "typeorm";
import { TaskEntity } from "../../../src/database/entities/task.entity";
import { insertRow } from "./insert-row";

export function createTask(
  db: EntityManager,
  values: Partial<TaskEntity> & { projectId: string },
): Promise<TaskEntity> {
  return insertRow(db, TaskEntity, {
    title: "Seed",
    status: "to-do",
    number: 1,
    ...values,
  });
}
