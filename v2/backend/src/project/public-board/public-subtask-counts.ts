import type { EntityManager } from "typeorm";
import { taskIsCompleted } from "./board-sql";

export type SubtaskCounts = { completed: number; total: number };

/**
 * Direct-child progress for a page of tasks, independent of board filters.
 * A public board counts only children in public projects of the workspace.
 */
export async function getPublicSubtaskCounts(
  manager: EntityManager,
  taskIds: string[],
  workspaceId: string,
): Promise<Map<string, SubtaskCounts>> {
  if (taskIds.length === 0) return new Map();

  const rows = (await manager.query(
    `SELECT task_relation.source_task_id AS "taskId",
            count(distinct task.id) AS total,
            count(distinct task.id) filter (where ${taskIsCompleted}) AS completed
     FROM task_relation
     INNER JOIN task ON task_relation.target_task_id = task.id
     INNER JOIN project ON task.project_id = project.id
     WHERE task_relation.source_task_id = ANY($1::text[])
       AND task_relation.relation_type = 'subtask'
       AND project.workspace_id = $2
       AND project.is_public = true
     GROUP BY task_relation.source_task_id`,
    [taskIds, workspaceId],
  )) as { taskId: string; total: string; completed: string }[];

  return new Map(
    rows.map(({ taskId, completed, total }) => [
      taskId,
      { completed: Number(completed), total: Number(total) },
    ]),
  );
}
