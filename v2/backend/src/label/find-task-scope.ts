import type { EntityManager } from "typeorm";

export type TaskScope = { id: string; projectId: string; workspaceId: string };

/** A task with the project and workspace it belongs to. */
export async function findTaskScope(
  manager: EntityManager,
  taskId: string,
): Promise<TaskScope | undefined> {
  const [task] = (await manager.query(
    `SELECT t.id, t.project_id AS "projectId", p.workspace_id AS "workspaceId"
     FROM task t
     INNER JOIN project p ON t.project_id = p.id
     WHERE t.id = $1
     LIMIT 1`,
    [taskId],
  )) as TaskScope[];
  return task;
}
