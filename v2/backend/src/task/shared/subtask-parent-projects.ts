import type { EntityManager } from "typeorm";

export type ParentProject = { projectId: string };

/** Boards whose subtask counters depend on these children, in any project. */
export async function getSubtaskParentProjects(
  manager: EntityManager,
  taskIds: string[],
): Promise<ParentProject[]> {
  if (taskIds.length === 0) return [];
  return (await manager.query(
    `SELECT DISTINCT parent.project_id AS "projectId"
     FROM task_relation r
     INNER JOIN task parent ON r.source_task_id = parent.id
     WHERE r.target_task_id = ANY($1::text[]) AND r.relation_type = 'subtask'`,
    [taskIds],
  )) as ParentProject[];
}
