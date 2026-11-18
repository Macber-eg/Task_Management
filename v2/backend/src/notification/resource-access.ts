import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";

/**
 * SQL that is true when the user may be told about the resource.
 *
 * Membership, rather than public visibility or global admin privileges,
 * defines who may be subscribed to private task activity. Use the same
 * predicate when creating, reading and delivering notifications, including
 * historical rows.
 *
 * All arguments are SQL fragments: bind placeholders or column references.
 * Never interpolate a value.
 */
export function notificationResourceAccess(
  userId: string,
  resourceId: string,
  resourceType: string,
) {
  return `(
    (${resourceId}::text IS NULL AND ${resourceType}::text IS NULL)
    OR (${resourceType}::text = 'task' AND EXISTS (
      SELECT 1 FROM task AS notification_task
      JOIN project AS notification_project ON notification_project.id = notification_task.project_id
      JOIN workspace_member AS notification_member ON notification_member.workspace_id = notification_project.workspace_id
      WHERE notification_task.id = ${resourceId} AND notification_member.user_id = ${userId}
        AND ${projectAccessCondition(userId, "notification_project.id")}
    ))
    OR (${resourceType}::text = 'workspace' AND EXISTS (
      SELECT 1 FROM workspace_member AS notification_member
      WHERE notification_member.workspace_id = ${resourceId} AND notification_member.user_id = ${userId}
    ))
  )`;
}

export async function canReceiveResourceNotification(
  manager: EntityManager,
  userId: string,
  resourceId?: string | null,
  resourceType?: string | null,
): Promise<boolean> {
  const rows = (await manager.query(
    `SELECT u.id FROM "user" AS u
     WHERE u.id = $1
       AND ${notificationResourceAccess("$1", "$2", "$3")}
     LIMIT 1`,
    [userId, resourceId ?? null, resourceType ?? null],
  )) as unknown[];
  return rows.length > 0;
}
