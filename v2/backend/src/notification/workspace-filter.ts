/**
 * SQL limiting notifications (aliased `n`) to one workspace, plus user-wide
 * notifications with no resource. `workspaceId` is a bind placeholder.
 *
 * Resolve the resource's current workspace, rather than trusting eventData,
 * which integrations can supply and older notifications may omit.
 */
export function notificationWorkspaceFilter(workspaceId: string) {
  return `(
    (n.resource_id IS NULL AND n.resource_type IS NULL)
    OR
    (n.resource_type = 'workspace' AND n.resource_id = ${workspaceId})
    OR (n.resource_type = 'task' AND EXISTS (
      SELECT 1 FROM task AS inbox_task
      JOIN project AS inbox_project ON inbox_project.id = inbox_task.project_id
      WHERE inbox_task.id = n.resource_id
        AND inbox_project.workspace_id = ${workspaceId}
    ))
  )`;
}
