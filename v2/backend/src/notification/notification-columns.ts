import type { NotificationEntity } from "../database/entities/notification.entity";

export type NotificationRow = Omit<NotificationEntity, "user">;

/** A notification row (aliased `n`) under its API property names. */
export const NOTIFICATION_COLUMNS = `n.id, n.user_id AS "userId", n.title, n.content, n.type,
  n.event_data AS "eventData", n.is_read AS "isRead", n.resource_id AS "resourceId",
  n.resource_type AS "resourceType", n.created_at AS "createdAt", n.updated_at AS "updatedAt"`;
