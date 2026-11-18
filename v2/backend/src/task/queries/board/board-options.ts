import type { TaskSortBy } from "./task-sort";

export type GetTasksOptions = {
  publicOnly?: boolean;
  assigneeId?: string;
  phaseId?: string;
  sprintId?: string;
  dueAfter?: string;
  dueBefore?: string;
  limit?: number;
  page?: number;
  relatedPage?: number;
  priority?: string;
  sortBy?: TaskSortBy;
  sortOrder?: "asc" | "desc";
  status?: string;
};

export type TaskFilter = { sql: string; parameters: unknown[] };

/**
 * The filter a board page applies to tasks aliased `t`, as SQL and its bind
 * values. The project id is always `$1`.
 */
export function boardTaskFilter(
  projectId: string,
  options: GetTasksOptions,
): TaskFilter {
  const parameters: unknown[] = [projectId];
  const conditions = ["t.project_id = $1"];
  const add = (sql: string, value: unknown) => {
    parameters.push(value);
    conditions.push(`${sql} $${parameters.length}`);
  };

  if (options.status) add("t.status =", options.status);
  if (options.priority) add("t.priority =", options.priority);
  if (options.assigneeId) add("t.assignee_id =", options.assigneeId);
  if (options.sprintId) add("t.sprint_id =", options.sprintId);
  else if (options.phaseId) add("t.phase_id =", options.phaseId);
  if (options.dueBefore) add("t.due_date <=", new Date(options.dueBefore));
  if (options.dueAfter) add("t.due_date >=", new Date(options.dueAfter));

  return { sql: conditions.join(" AND "), parameters };
}
