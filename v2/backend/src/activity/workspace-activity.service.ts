import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import { commentExcerpt } from "./comment-excerpt";
import { redactInaccessibleMoves } from "./redact-inaccessible-moves";

export const WORKSPACE_ACTIVITY_LIMIT = 20;

// The feed is "what happened lately". The window also keeps the scan bounded
// in workspaces with years of history.
const WINDOW_DAYS = 30;

type WorkspaceActivityRow = {
  id: string;
  type: string;
  createdAt: Date;
  content: string | null;
  eventData: unknown;
  userId: string | null;
  userName: string | null;
  userImage: string | null;
  externalUserName: string | null;
  externalUserAvatar: string | null;
  taskId: string;
  taskTitle: string;
  taskNumber: number | null;
  projectId: string;
  projectSlug: string;
};

type ColumnName = { projectId: string; slug: string; name: string };

function statusData(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Recent events across a workspace's active projects. */
@Injectable()
export class WorkspaceActivityService {
  constructor(private readonly dataSource: DataSource) {}

  async getWorkspaceActivities(workspaceId: string, userId: string) {
    const manager = this.dataSource.manager;
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Concrete project IDs let PostgreSQL estimate task selectivity before it
    // chooses an activity index. A join-only workspace filter can instead scan
    // every tenant's recent events to fill a quiet workspace's small feed.
    const projects = (await manager.query(
      `SELECT p.id FROM project AS p
       WHERE p.workspace_id = $1
         AND p.archived_at IS NULL
         AND ${projectAccessCondition("$2", "p.id")}`,
      [workspaceId, userId],
    )) as { id: string }[];
    if (!projects.length) return [];

    const rows = (await manager.query(
      `SELECT a.id, a.type, a.created_at AS "createdAt", a.content,
              a.event_data AS "eventData", a.user_id AS "userId",
              u.name AS "userName", u.image AS "userImage",
              a.external_user_name AS "externalUserName",
              a.external_user_avatar AS "externalUserAvatar",
              t.id AS "taskId", t.title AS "taskTitle", t.number AS "taskNumber",
              p.id AS "projectId", p.slug AS "projectSlug"
       FROM activity AS a
       INNER JOIN task AS t ON a.task_id = t.id
       INNER JOIN project AS p ON t.project_id = p.id
       LEFT JOIN "user" AS u ON a.user_id = u.id
       WHERE p.workspace_id = $1
         AND t.project_id = ANY($2::text[])
         AND p.archived_at IS NULL
         AND a.created_at >= $3
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $4`,
      [
        workspaceId,
        projects.map((project) => project.id),
        since,
        WORKSPACE_ACTIVITY_LIMIT,
      ],
    )) as WorkspaceActivityRow[];

    const statusChanges = rows.filter((row) => row.type === "status_changed");
    const statusSlugs = [
      ...new Set(
        statusChanges.flatMap((row) => {
          const data = statusData(row.eventData);
          return [data?.oldStatus, data?.newStatus].filter(
            (value): value is string => typeof value === "string",
          );
        }),
      ),
    ];
    const columns = statusSlugs.length
      ? ((await manager.query(
          `SELECT c.project_id AS "projectId", c.slug, c.name
           FROM "column" AS c
           INNER JOIN project AS p ON c.project_id = p.id
           WHERE p.workspace_id = $1
             AND c.project_id = ANY($2::text[])
             AND c.slug = ANY($3::text[])`,
          [
            workspaceId,
            [...new Set(statusChanges.map((row) => row.projectId))],
            statusSlugs,
          ],
        )) as ColumnName[])
      : [];

    const activities = rows.map(({ content, ...row }) => {
      const data =
        row.type === "status_changed" ? statusData(row.eventData) : null;
      const nameOf = (slug: unknown) => {
        const matching = columns.filter(
          (column) =>
            column.projectId === row.projectId && column.slug === slug,
        );
        // Historical events only store slugs. Duplicates cannot identify a column.
        return matching.length === 1 ? matching[0]?.name : undefined;
      };
      return {
        ...row,
        eventData: data
          ? {
              ...data,
              oldStatusName: nameOf(data.oldStatus),
              newStatusName: nameOf(data.newStatus),
            }
          : row.eventData,
        excerpt: commentExcerpt(content),
      };
    });
    return redactInaccessibleMoves(manager, userId, activities);
  }
}
