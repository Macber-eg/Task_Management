import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../../access/project-access-condition";
import { taskIsCompletedSql } from "./task-is-completed";

export type SubtaskCounts = { completed: number; total: number };

/** Direct-child progress for a page of tasks, independent of board filters. */
export async function getSubtaskCounts(
  manager: EntityManager,
  taskIds: string[],
  workspaceId: string,
  publicOnly: boolean,
  userId?: string,
): Promise<Map<string, SubtaskCounts>> {
  if (taskIds.length === 0) {
    return new Map();
  }

  const parameters: unknown[] = [taskIds, workspaceId];
  const conditions = [
    "r.source_task_id = ANY($1::text[])",
    "r.relation_type = 'subtask'",
    "p.workspace_id = $2",
  ];
  if (publicOnly) conditions.push("p.is_public = true");
  if (userId) {
    parameters.push(userId);
    conditions.push(projectAccessCondition(`$${parameters.length}`, "p.id"));
  }

  const rows = (await manager.query(
    `SELECT r.source_task_id AS "taskId",
       count(distinct child.id)::int AS total,
       (count(distinct child.id) filter (where ${taskIsCompletedSql("child")}))::int AS completed
     FROM task_relation r
     INNER JOIN task child ON r.target_task_id = child.id
     INNER JOIN project p ON child.project_id = p.id
     WHERE ${conditions.join(" AND ")}
     GROUP BY r.source_task_id`,
    parameters,
  )) as ({ taskId: string } & SubtaskCounts)[];

  return new Map(
    rows.map(({ taskId, completed, total }) => [taskId, { completed, total }]),
  );
}
