import type { EntityManager } from "typeorm";
import type { TaskEntity } from "../../database/entities/task.entity";

/** Every stored task column, keyed and ordered like the entity. */
export type TaskRow = Pick<
  TaskEntity,
  | "id"
  | "projectId"
  | "position"
  | "number"
  | "userId"
  | "title"
  | "description"
  | "status"
  | "columnId"
  | "phaseId"
  | "sprintId"
  | "priority"
  | "startDate"
  | "dueDate"
  | "estimatedMinutes"
  | "createdAt"
  | "updatedAt"
>;

/**
 * The select list for a `TaskRow` from table alias `t`. `description` may be
 * replaced by another expression (the board's bounded description).
 */
export function taskRowColumns(description = "t.description") {
  return `t.id, t.project_id AS "projectId", t.position, t.number,
    t.assignee_id AS "userId", t.title, ${description} AS description, t.status,
    t.column_id AS "columnId", t.phase_id AS "phaseId", t.sprint_id AS "sprintId",
    t.priority, t.start_date AS "startDate", t.due_date AS "dueDate",
    t.estimated_minutes AS "estimatedMinutes", t.created_at AS "createdAt",
    t.updated_at AS "updatedAt"`;
}

export async function findTaskRow(
  manager: EntityManager,
  id: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<TaskRow | undefined> {
  const [task] = (await manager.query(
    `SELECT ${taskRowColumns()} FROM task t WHERE t.id = $1${lock ? " FOR UPDATE" : " LIMIT 1"}`,
    [id],
  )) as TaskRow[];
  return task;
}
