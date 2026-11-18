import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { updateReturning } from "../../database/dml";
import { ColumnEntity } from "../../database/entities/column.entity";
import { IntegrationEntity } from "../../database/entities/integration.entity";
import { TaskEntity } from "../../database/entities/task.entity";
import { extractTaskLinks } from "./task-references";

export type UpdateTaskStatusResult =
  | { applied: false }
  | { applied: true; before: TaskEntity; after: TaskEntity };

const NON_COLUMN_STATUSES = new Set(["planned", "archived"]);
const logger = new Logger("IntegrationTasks");

export function findTaskByNumber(
  db: EntityManager,
  projectId: string,
  taskNumber: number,
): Promise<TaskEntity | null> {
  return db.findOne(TaskEntity, { where: { projectId, number: taskNumber } });
}

/** The task a text links to, when it links to exactly one in this project. */
export async function findTaskByLink(
  db: EntityManager,
  projectId: string,
  texts: (string | null | undefined)[],
): Promise<TaskEntity | null | undefined> {
  const links = extractTaskLinks(...texts);
  const link = links.length === 1 ? links[0] : undefined;
  if (link?.projectId !== projectId) return;
  return db.findOne(TaskEntity, { where: { projectId, id: link.taskId } });
}

export function findTaskById(
  db: EntityManager,
  taskId: string,
): Promise<TaskEntity | null> {
  return db.findOne(TaskEntity, { where: { id: taskId } });
}

/** Moves a task to the column with slug `newStatus` (or a column-less status). */
export async function updateTaskStatus(
  db: EntityManager,
  taskId: string,
  newStatus: string,
): Promise<UpdateTaskStatusResult> {
  const task = await db.findOne(TaskEntity, { where: { id: taskId } });
  if (!task) {
    return { applied: false };
  }

  let columnId: string | null = null;
  const column = await db.findOne(ColumnEntity, {
    where: { projectId: task.projectId, slug: newStatus },
  });

  if (column) {
    columnId = column.id;
  } else if (!NON_COLUMN_STATUSES.has(newStatus)) {
    logger.warn(
      `Skipping status update for task ${taskId}: column "${newStatus}" not found in project ${task.projectId}`,
    );
    return { applied: false };
  }

  const [after] = await updateReturning(
    db,
    TaskEntity,
    { status: newStatus, columnId },
    { id: taskId, projectId: task.projectId },
  );
  if (!after) {
    return { applied: false };
  }
  return { applied: true, before: task, after };
}

/** Whether the task sits in a final (completed) column. */
export async function isTaskInFinalState(
  db: EntityManager,
  task: { projectId: string; status: string; columnId: string | null },
): Promise<boolean> {
  if (task.columnId) {
    const columnById = await db.findOne(ColumnEntity, {
      where: { id: task.columnId, projectId: task.projectId },
    });
    if (columnById) {
      return columnById.isFinal;
    }
  }

  const columnByStatus = await db.findOne(ColumnEntity, {
    where: { projectId: task.projectId, slug: task.status },
  });
  if (columnByStatus) {
    return columnByStatus.isFinal;
  }

  return task.status === "done";
}

export function getIntegrationWithProject(
  db: EntityManager,
  integrationId: string,
): Promise<IntegrationEntity | null> {
  return db.findOne(IntegrationEntity, {
    where: { id: integrationId },
    relations: { project: true },
  });
}
