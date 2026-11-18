import type { EntityManager } from "typeorm";

/**
 * Boards whose subtask counters depend on a child task in this project,
 * including boards of other projects. Optionally only children with one
 * status. Read before a project cascade or a column change.
 */
export function getProjectSubtaskParentProjects(
  manager: EntityManager,
  projectId: string,
  status?: string,
): Promise<{ projectId: string }[]> {
  const parameters = [projectId];
  if (status !== undefined) parameters.push(status);
  return manager.query(
    `SELECT DISTINCT task.project_id AS "projectId"
     FROM task_relation
     INNER JOIN task ON task_relation.source_task_id = task.id
     INNER JOIN task AS child ON task_relation.target_task_id = child.id
     WHERE child.project_id = $1
       ${status === undefined ? "" : "AND child.status = $2"}
       AND task_relation.relation_type = 'subtask'`,
    parameters,
  );
}
