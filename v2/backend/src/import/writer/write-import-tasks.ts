import type { EntityManager } from "typeorm";
import { ActivityEntity } from "../../database/entities/activity.entity";
import { TaskEntity } from "../../database/entities/task.entity";
import { chunk } from "./chunk";
import { insertRows } from "./insert-rows";
import type { PlannedImportTask } from "./plan-import-tasks";

export async function writeImportTasks(
  tx: EntityManager,
  projectId: string,
  importedBy: string,
  tasks: readonly PlannedImportTask[],
) {
  for (const batch of chunk(tasks)) {
    await insertRows(
      tx,
      TaskEntity,
      batch.map((task) => ({
        id: task.id,
        projectId,
        number: task.number,
        title: task.title,
        description: task.description,
        status: task.status,
        columnId: task.columnId,
        position: task.position,
        priority: task.priority,
        startDate: task.startDate,
        dueDate: task.dueDate,
        createdAt: task.createdAt,
        userId: task.userId,
      })),
    );

    await insertRows(
      tx,
      ActivityEntity,
      batch.map((task) => ({
        taskId: task.id,
        type: "created",
        userId: importedBy,
        content: null,
        eventData: {},
        createdAt: task.createdAt,
      })),
    );
  }
}
