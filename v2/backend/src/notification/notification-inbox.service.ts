import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { NOTIFICATION_COLUMNS, type NotificationRow } from "./notification-columns";
import { notificationResourceAccess } from "./resource-access";
import { notificationWorkspaceFilter } from "./workspace-filter";

/** Reading and clearing a user's notifications. */
@Injectable()
export class NotificationInboxService {
  constructor(private readonly dataSource: DataSource) {}

  async markNotificationAsRead(
    id: string,
    userId: string,
  ): Promise<NotificationRow> {
    const [rows] = (await this.dataSource.query(
      `UPDATE notification AS n
       SET is_read = true, updated_at = $3
       WHERE n.id = $1 AND n.user_id = $2
         AND ${notificationResourceAccess("$2", "n.resource_id", "n.resource_type")}
       RETURNING ${NOTIFICATION_COLUMNS}`,
      [id, userId, new Date()],
    )) as [NotificationRow[], number];
    const [notification] = rows;

    if (!notification) {
      throw new HTTPException(404, {
        message: "Notification not found",
      });
    }

    return notification;
  }

  async markAllNotificationsAsRead(userId: string, workspaceId?: string) {
    await this.dataSource.query(
      `UPDATE notification AS n
       SET is_read = true, updated_at = $2
       WHERE n.user_id = $1 ${this.workspaceScope(workspaceId, "$3")}`,
      workspaceId ? [userId, new Date(), workspaceId] : [userId, new Date()],
    );

    return { success: true };
  }

  async clearNotifications(userId: string, workspaceId?: string) {
    await this.dataSource.query(
      `DELETE FROM notification AS n
       WHERE n.user_id = $1 ${this.workspaceScope(workspaceId, "$2")}`,
      workspaceId ? [userId, workspaceId] : [userId],
    );

    return { success: true };
  }

  /** Without a workspace, every notification of the user is affected. */
  private workspaceScope(workspaceId: string | undefined, placeholder: string) {
    if (!workspaceId) return "";
    return `AND ${notificationWorkspaceFilter(placeholder)}
      AND ${notificationResourceAccess("$1", "n.resource_id", "n.resource_type")}`;
  }
}
