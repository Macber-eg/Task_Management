import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { NOTIFICATION_COLUMNS, type NotificationRow } from "./notification-columns";
import { notificationResourceAccess } from "./resource-access";
import { notificationWorkspaceFilter } from "./workspace-filter";

type InboxRow = NotificationRow & {
  currentProjectId: string | null;
  currentWorkspaceId: string | null;
};

const INBOX_LIMIT = 50;

@Injectable()
export class NotificationQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The newest notifications the user may still see. Task notifications get
   * the task's current project and workspace in `eventData`.
   */
  async getNotifications(
    userId: string,
    workspaceId?: string,
  ): Promise<NotificationRow[]> {
    const parameters: unknown[] = [userId];
    let workspaceCondition = "";
    if (workspaceId) {
      parameters.push(workspaceId);
      workspaceCondition = `AND ${notificationWorkspaceFilter("$2")}`;
    }

    const rows = (await this.dataSource.query(
      `SELECT ${NOTIFICATION_COLUMNS},
         p.id AS "currentProjectId", w.id AS "currentWorkspaceId"
       FROM notification AS n
       LEFT JOIN task AS t ON n.resource_id = t.id AND n.resource_type = 'task'
       LEFT JOIN project AS p ON t.project_id = p.id
       LEFT JOIN workspace AS w ON p.workspace_id = w.id
       WHERE n.user_id = $1
         ${workspaceCondition}
         AND ${notificationResourceAccess("$1", "n.resource_id", "n.resource_type")}
       ORDER BY n.created_at DESC
       LIMIT ${INBOX_LIMIT}`,
      parameters,
    )) as InboxRow[];

    return rows.map(
      ({ currentProjectId: projectId, currentWorkspaceId, ...notification }) => {
        if (!projectId && !currentWorkspaceId) {
          return notification;
        }

        const existing =
          notification.eventData &&
          typeof notification.eventData === "object" &&
          !Array.isArray(notification.eventData)
            ? (notification.eventData as Record<string, unknown>)
            : {};

        return {
          ...notification,
          eventData: {
            ...existing,
            projectId: projectId ?? existing.projectId ?? null,
            workspaceId: currentWorkspaceId ?? existing.workspaceId ?? null,
          },
        };
      },
    );
  }
}
