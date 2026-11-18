import type { EntityManager } from "typeorm";

export type TaskLocation = { projectId: string; workspaceId: string };

/** The project and workspace a task is in now, if it still exists. */
export async function findTaskLocation(
  manager: EntityManager,
  taskId: string,
): Promise<TaskLocation | undefined> {
  const [row] = (await manager.query(
    `SELECT t.project_id AS "projectId", p.workspace_id AS "workspaceId"
     FROM task AS t
     INNER JOIN project AS p ON p.id = t.project_id
     WHERE t.id = $1
     LIMIT 1`,
    [taskId],
  )) as TaskLocation[];
  return row;
}

/** The workspace of a project, if it still exists. */
export async function findProjectWorkspaceId(
  manager: EntityManager,
  projectId: string,
): Promise<string | undefined> {
  const [row] = (await manager.query(
    `SELECT workspace_id AS "workspaceId" FROM project WHERE id = $1 LIMIT 1`,
    [projectId],
  )) as { workspaceId: string }[];
  return row?.workspaceId;
}
