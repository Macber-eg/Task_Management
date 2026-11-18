import type { PublicBoardOptions } from "./public-board-query";

/** Descriptions above 64 KiB are left out of board payloads. */
export const BOARD_DESCRIPTION_MAX_BYTES = 64 * 1024;

export function descriptionDeferred(table: string) {
  return `coalesce(octet_length(${table}.description) > ${BOARD_DESCRIPTION_MAX_BYTES}, false)`;
}

export function boardDescription(table: string) {
  return `case when ${descriptionDeferred(table)} then null else ${table}.description end`;
}

/** Completion belongs to the task's workflow, even when its parent is elsewhere. */
export const taskIsCompleted = `exists (
  select 1 from "column"
  where "column".project_id = task.project_id
    and "column".slug = task.status
    and "column".is_final = true
)`;

const PRIORITY_RANK = `CASE
  WHEN task.priority = 'urgent' THEN 4
  WHEN task.priority = 'high' THEN 3
  WHEN task.priority = 'medium' THEN 2
  WHEN task.priority = 'low' THEN 1
  ELSE 0
END`;

export function sortValue(sortBy: PublicBoardOptions["sortBy"]): string {
  switch (sortBy) {
    case "createdAt":
      return "task.created_at";
    case "priority":
      return PRIORITY_RANK;
    case "dueDate":
      return "task.due_date";
    case "title":
      return "task.title";
    case "number":
      return "task.number";
    default:
      return "task.position";
  }
}

/** A content hash over the rows a query aggregates, as text. */
export function boardRevision(fields: string[]): string {
  return `coalesce(sum(hashtextextended(jsonb_build_array(${fields.join(", ")})::text, 0)::numeric), 0)::text`;
}

/** The board's task filter; its parameters are `$1..$n`. */
export function taskFilter(
  projectId: string,
  options: PublicBoardOptions,
): { where: string; parameters: unknown[] } {
  const parameters: unknown[] = [projectId];
  const conditions = ["task.project_id = $1"];
  const add = (condition: (placeholder: string) => string, value: unknown) => {
    parameters.push(value);
    conditions.push(condition(`$${parameters.length}`));
  };

  if (options.status) add((p) => `task.status = ${p}`, options.status);
  if (options.priority) add((p) => `task.priority = ${p}`, options.priority);
  if (options.assigneeId)
    add((p) => `task.assignee_id = ${p}`, options.assigneeId);
  if (options.sprintId) add((p) => `task.sprint_id = ${p}`, options.sprintId);
  else if (options.phaseId) add((p) => `task.phase_id = ${p}`, options.phaseId);
  if (options.dueBefore)
    add((p) => `task.due_date <= ${p}`, new Date(options.dueBefore));
  if (options.dueAfter)
    add((p) => `task.due_date >= ${p}`, new Date(options.dueAfter));

  return { where: conditions.join(" AND "), parameters };
}
