import type { EntityManager } from "typeorm";

/**
 * The column slug an issue event moves a task to: the project's workflow rule
 * for this provider (`integrationType`) and event, else `fallbackStatus` when
 * such a column exists, else the first column.
 */
export async function resolveTargetStatus(
  db: EntityManager,
  integrationType: string,
  projectId: string,
  eventType: string,
  fallbackStatus: string,
): Promise<string> {
  const projectColumns = (await db.query(
    `SELECT id, slug FROM "column" WHERE project_id = $1 ORDER BY position ASC`,
    [projectId],
  )) as { id: string; slug: string }[];

  if (projectColumns.length === 0) {
    return fallbackStatus;
  }

  const [rule] = (await db.query(
    `SELECT column_id AS "columnId" FROM workflow_rule
     WHERE project_id = $1 AND integration_type = $2 AND event_type = $3
     LIMIT 1`,
    [projectId, integrationType, eventType],
  )) as { columnId: string }[];

  if (rule) {
    const mappedColumn = projectColumns.find(
      (column) => column.id === rule.columnId,
    );
    if (mappedColumn) {
      return mappedColumn.slug;
    }
  }

  const fallbackColumn = projectColumns.find(
    (column) => column.slug === fallbackStatus,
  );
  if (fallbackColumn) {
    return fallbackColumn.slug;
  }

  return projectColumns[0]?.slug ?? fallbackStatus;
}
