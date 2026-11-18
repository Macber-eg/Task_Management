export function getClientUrl() {
  return process.env.KANEO_CLIENT_URL || "http://localhost:5173";
}

export function buildTaskUrl(
  workspaceId: string,
  projectId: string,
  taskId: string,
) {
  return `${getClientUrl()}/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`;
}
