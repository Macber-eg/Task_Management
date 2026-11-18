import type { EntityManager } from "typeorm";
import { ProjectEntity } from "../../../src/database/entities/project.entity";
import { TaskEntity } from "../../../src/database/entities/task.entity";
import { insertRow } from "./insert-row";

/**
 * A task as the duplication tests seed it, with the project's task counter
 * advanced to its number so the next task gets the following one.
 */
export async function seedCountedTask(
  db: EntityManager,
  {
    projectId,
    columnId,
    userId,
    overrides,
  }: {
    projectId: string;
    columnId: string | null;
    userId?: string;
    overrides?: Partial<TaskEntity>;
  },
): Promise<TaskEntity> {
  const task = await insertRow(db, TaskEntity, {
    projectId,
    columnId,
    title: "Release checklist",
    description: "Steps to cut a release",
    status: "to-do",
    priority: "high",
    number: 1,
    position: 1,
    ...(userId ? { userId } : {}),
    ...overrides,
  });
  await db.update(
    ProjectEntity,
    { id: projectId },
    { lastTaskNumber: task.number ?? 1 },
  );
  return task;
}
