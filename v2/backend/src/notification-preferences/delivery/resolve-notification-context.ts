import type { EntityManager } from "typeorm";
import { buildTaskUrl } from "./client-url";

export type ResolvedNotificationContext = {
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskUrl: string | null;
};

/**
 * Where a notification points now: its task's project and workspace, or its
 * workspace. Null when the resource is gone or of an unsupported type.
 */
export async function resolveNotificationContext(
  manager: EntityManager,
  notification: { resourceType: string | null; resourceId: string | null },
): Promise<ResolvedNotificationContext | null> {
  if (!notification.resourceType || !notification.resourceId) {
    return null;
  }

  if (notification.resourceType === "task") {
    const [task] = (await manager.query(
      `SELECT t.id AS "taskId", t.title AS "taskTitle",
         p.id AS "projectId", p.name AS "projectName",
         w.id AS "workspaceId", w.name AS "workspaceName"
       FROM task AS t
       INNER JOIN project AS p ON t.project_id = p.id
       INNER JOIN workspace AS w ON p.workspace_id = w.id
       WHERE t.id = $1
       LIMIT 1`,
      [notification.resourceId],
    )) as {
      taskId: string;
      taskTitle: string;
      projectId: string;
      projectName: string;
      workspaceId: string;
      workspaceName: string;
    }[];

    if (!task) {
      return null;
    }

    return {
      workspaceId: task.workspaceId,
      workspaceName: task.workspaceName,
      projectId: task.projectId,
      projectName: task.projectName,
      taskId: task.taskId,
      taskTitle: task.taskTitle,
      taskUrl: buildTaskUrl(task.workspaceId, task.projectId, task.taskId),
    };
  }

  if (notification.resourceType === "workspace") {
    const [workspace] = (await manager.query(
      `SELECT id AS "workspaceId", name AS "workspaceName"
       FROM workspace WHERE id = $1 LIMIT 1`,
      [notification.resourceId],
    )) as { workspaceId: string; workspaceName: string }[];

    if (!workspace) {
      return null;
    }

    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      projectId: null,
      projectName: null,
      taskId: null,
      taskTitle: null,
      taskUrl: null,
    };
  }

  return null;
}
