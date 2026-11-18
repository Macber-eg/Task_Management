/** The web app link of a task, falling back to the default dev client URL. */
export function taskUrl(task: {
  id: string;
  projectId: string;
  workspaceId: string;
}): string {
  const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
  return `${clientUrl}/dashboard/workspace/${task.workspaceId}/project/${task.projectId}/task/${task.id}`;
}
