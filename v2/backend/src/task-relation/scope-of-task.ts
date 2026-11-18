import type { EntityManager } from "typeorm";

export type TaskWorkspaceScope = { workspaceId: string; projectId: string };

/** The workspace and project a task belongs to. */
export async function scopeOfTask(
  manager: EntityManager,
  taskId: string,
): Promise<TaskWorkspaceScope | null> {
  const [task] = (await manager.query(
    `SELECT p.workspace_id AS "workspaceId", p.id AS "projectId"
     FROM task AS t
     INNER JOIN project AS p ON t.project_id = p.id
     WHERE t.id = $1
     LIMIT 1`,
    [taskId],
  )) as TaskWorkspaceScope[];
  return task ?? null;
}
