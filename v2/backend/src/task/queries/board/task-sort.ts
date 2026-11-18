export type TaskSortBy =
  "createdAt" | "priority" | "dueDate" | "position" | "title" | "number";

/** SQL ranking of the task aliased `task` by priority, urgent highest. */
export function priorityRankSql(task: string) {
  return `CASE
  WHEN ${task}.priority = 'urgent' THEN 4
  WHEN ${task}.priority = 'high' THEN 3
  WHEN ${task}.priority = 'medium' THEN 2
  WHEN ${task}.priority = 'low' THEN 1
  ELSE 0
END`;
}

/** SQL value a board is sorted by, for the task aliased `t`. */
export function sortValueSql(sortBy: TaskSortBy | undefined) {
  switch (sortBy) {
    case "createdAt":
      return "t.created_at";
    case "priority":
      return priorityRankSql("t");
    case "dueDate":
      return "t.due_date";
    case "title":
      return "t.title";
    case "number":
      return "t.number";
    default:
      return "t.position";
  }
}
