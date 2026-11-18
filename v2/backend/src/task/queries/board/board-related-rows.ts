import type { EntityManager } from "typeorm";
import { parseMetadata } from "./parse-metadata";

export const RELATED_PAGE_SIZE = 100;

export type TaskLabel = { id: string; name: string; color: string };

export type TaskExternalLink = {
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
  id: string;
  slug: string;
  name: string;
  position: number;
  icon: string | null;
  isFinal: boolean;
};

function groupByTask<R extends { taskId: string | null }, T>(
  rows: R[],
  pick: (row: R) => T,
) {
  const byTask = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.taskId) continue;
    const list = byTask.get(row.taskId) ?? [];
    list.push(pick(row));
    byTask.set(row.taskId, list);
  }
  return byTask;
}

/** One related page of the labels on these tasks, grouped by task. */
export async function loadTaskLabels(
  tx: EntityManager,
  taskIds: string[],
  offset: number,
): Promise<Map<string, TaskLabel[]>> {
  if (taskIds.length === 0) return new Map();
  const rows = (await tx.query(
    `SELECT id, name, color, task_id AS "taskId" FROM label
     WHERE task_id = ANY($1::text[])
     ORDER BY id ASC LIMIT ${RELATED_PAGE_SIZE} OFFSET ${offset}`,
    [taskIds],
  )) as (TaskLabel & { taskId: string | null })[];
  return groupByTask(rows, ({ id, name, color }) => ({ id, name, color }));
}

/** One related page of the external links on these tasks, grouped by task. */
export async function loadTaskExternalLinks(
  tx: EntityManager,
  taskIds: string[],
  offset: number,
): Promise<Map<string, TaskExternalLink[]>> {
  if (taskIds.length === 0) return new Map();
  const rows = (await tx.query(
    `SELECT id, task_id AS "taskId", integration_id AS "integrationId",
       resource_type AS "resourceType", external_id AS "externalId", url, title,
       metadata, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM external_link
     WHERE task_id = ANY($1::text[])
     ORDER BY id ASC LIMIT ${RELATED_PAGE_SIZE} OFFSET ${offset}`,
    [taskIds],
  )) as (Omit<TaskExternalLink, "metadata"> & { metadata: string | null })[];
  return groupByTask(rows, (link) => ({
    ...link,
    metadata: parseMetadata(link.metadata),
  }));
}

const COLUMN_FIELDS = `id, slug, name, position, icon, is_final AS "isFinal"`;

/**
 * One related page of the project's columns, plus the columns of any task
 * status on this task page that falls on a later column page, so every
 * selected task stays representable. At most 100 distinct statuses occur.
 */
export async function loadBoardColumns(
  tx: EntityManager,
  projectId: string,
  offset: number,
  taskStatuses: string[],
): Promise<BoardColumnRow[]> {
  const columns = (await tx.query(
    `SELECT ${COLUMN_FIELDS} FROM "column" WHERE project_id = $1
     ORDER BY position ASC, id ASC LIMIT ${RELATED_PAGE_SIZE} OFFSET ${offset}`,
    [projectId],
  )) as BoardColumnRow[];

  const missingStatuses = Array.from(new Set(taskStatuses)).filter(
    (status) =>
      status !== "planned" &&
      status !== "archived" &&
      !columns.some((column) => column.slug === status),
  );
  if (missingStatuses.length) {
    const taskColumns = (await tx.query(
      `SELECT DISTINCT ON (slug) ${COLUMN_FIELDS} FROM "column"
       WHERE project_id = $1 AND slug = ANY($2::text[])
       ORDER BY slug ASC, position ASC, id ASC LIMIT 100`,
      [projectId, missingStatuses],
    )) as BoardColumnRow[];
    columns.push(...taskColumns);
  }
  return columns;
}
