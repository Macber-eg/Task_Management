/**
 * SQL true when the task aliased `task` sits in a final column. Completion
 * belongs to the task's own workflow, even when its parent is elsewhere.
 */
export function taskIsCompletedSql(task: string) {
  return `exists (
    select 1 from "column" completed_column
    where completed_column.project_id = ${task}.project_id
      and completed_column.slug = ${task}.status
      and completed_column.is_final = true
  )`;
}
