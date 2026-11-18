import type { EntityManager } from "typeorm";

export const RELATED_PAGE_SIZE = 100;

export type BoardLabel = { id: string; name: string; color: string };

export type BoardExternalLink = {
  id: string;
  taskId: string;
  integrationId: string | null;
  resourceType: string;
  externalId: string;
  url: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BoardColumnRow = {
  slug: string;
  name: string;
  position: number;
  icon: string | null;
  isFinal: boolean;
};

const COLUMN_FIELDS = `slug, name, position, icon, is_final AS "isFinal"`;

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function groupByTask<R extends { taskId: string | null }, T>(
  rows: R[],
  map: (row: R) => T,
): Map<string, T[]> {
  const byTask = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.taskId) continue;
    const list = byTask.get(row.taskId) ?? [];
    list.push(map(row));
    byTask.set(row.taskId, list);
  }
  return byTask;
}

/** One related page of the labels on the given tasks, by task. */
export async function labelsByTask(
  manager: EntityManager,
  taskIds: string[],
  relatedOffset: number,
): Promise<Map<string, BoardLabel[]>> {
  if (taskIds.length === 0) return new Map();
  const rows = (await manager.query(
    `SELECT id, name, color, task_id AS "taskId" FROM label
     WHERE task_id = ANY($1::text[])
     ORDER BY id ASC LIMIT $2 OFFSET $3`,
    [taskIds, RELATED_PAGE_SIZE, relatedOffset],
  )) as (BoardLabel & { taskId: string | null })[];
  return groupByTask(rows, (label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
  }));
}

/** One related page of the external links on the given tasks, by task. */
export async function externalLinksByTask(
  manager: EntityManager,
  taskIds: string[],
  relatedOffset: number,
): Promise<Map<string, BoardExternalLink[]>> {
  if (taskIds.length === 0) return new Map();
  const rows = (await manager.query(
    `SELECT id, task_id AS "taskId", integration_id AS "integrationId",
            resource_type AS "resourceType", external_id AS "externalId",
            url, title, metadata, created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM external_link
     WHERE task_id = ANY($1::text[])
     ORDER BY id ASC LIMIT $2 OFFSET $3`,
    [taskIds, RELATED_PAGE_SIZE, relatedOffset],
  )) as (Omit<BoardExternalLink, "metadata"> & { metadata: string | null })[];
  return groupByTask(rows, (link) => ({
    ...link,
    metadata: parseMetadata(link.metadata),
  }));
}

/**
 * One related page of the project's columns, plus the columns the page's
 * tasks sit in when those fall on a later page (at most 100 statuses).
 */
export async function boardColumns(
  manager: EntityManager,
  projectId: string,
  relatedOffset: number,
  taskStatuses: string[],
): Promise<BoardColumnRow[]> {
  const columns = (await manager.query(
    `SELECT ${COLUMN_FIELDS} FROM "column"
     WHERE project_id = $1
     ORDER BY position ASC, id ASC LIMIT $2 OFFSET $3`,
    [projectId, RELATED_PAGE_SIZE, relatedOffset],
  )) as BoardColumnRow[];

  const missingStatuses = Array.from(new Set(taskStatuses)).filter(
    (status) =>
      status !== "planned" &&
      status !== "archived" &&
      !columns.some((column) => column.slug === status),
  );
  if (missingStatuses.length) {
    const taskColumns = (await manager.query(
      `SELECT DISTINCT ON (slug) ${COLUMN_FIELDS} FROM "column"
       WHERE project_id = $1 AND slug = ANY($2::text[])
       ORDER BY slug ASC, position ASC, id ASC LIMIT 100`,
      [projectId, missingStatuses],
    )) as BoardColumnRow[];
    columns.push(...taskColumns);
  }
  return columns;
}
