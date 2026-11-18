import type { EntityManager } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";

export const BULK_OPERATIONS = [
  "updateStatus",
  "updatePriority",
  "updateAssignee",
  "delete",
  "addLabel",
  "removeLabel",
  "updateDueDate",
] as const;

export type BulkOperation = (typeof BULK_OPERATIONS)[number];

/** A task as the bulk route found it, before taking any lock. */
export type BulkTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  userId: string | null;
  dueDate: Date | null;
  workspaceId: string;
};

export type BulkContext = {
  tasks: BulkTask[];
  foundIds: string[];
  workspaceId: string;
  value?: string | null;
  userId: string;
};

const CHANGED_PROJECTS = "Tasks changed projects; retry the operation";

/**
 * Locks the tasks in id order with the given columns, refusing when any
 * disappeared or moved to another project since they were first read.
 */
export async function lockUnmovedTasks<
  T extends { id: string; projectId: string },
>(tx: EntityManager, context: BulkContext, columns: string): Promise<T[]> {
  const locked = (await tx.query(
    `SELECT ${columns} FROM task WHERE id = ANY($1::text[])
     ORDER BY id ASC FOR UPDATE`,
    [context.foundIds],
  )) as T[];
  const originalProjects = new Map(
    context.tasks.map((task) => [task.id, task.projectId]),
  );
  if (
    locked.length !== context.foundIds.length ||
    locked.some((task) => task.projectId !== originalProjects.get(task.id))
  )
    throw new HTTPException(409, { message: CHANGED_PROJECTS });
  return locked;
}

export function changedProjectsError() {
  return new HTTPException(409, { message: CHANGED_PROJECTS });
}
