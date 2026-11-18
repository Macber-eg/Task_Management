import type { EntityManager } from "typeorm";
import type { LabelRule } from "./rules";
import { joinSql, type SqlFragment, sql } from "./sql-fragment";

export type WorkspaceLabel = { id: string; name: string; color: string };

/**
 * The SQL condition (on the `task` table, which must be in scope as `task`)
 * for tasks matching an outgoing rule. Rules select workspace labels by id and
 * match task label copies by name; a missing selected label matches nothing.
 */
export async function outgoingPredicate(
  db: EntityManager,
  workspaceId: string,
  rule: LabelRule,
  includeAllLabels = false,
): Promise<{
  predicate: SqlFragment;
  labels: WorkspaceLabel[];
  missing: string[];
}> {
  // Only the settings preview needs the full picker. Eligibility checks resolve
  // selected roots afresh without loading unrelated workspace labels.
  const labels: WorkspaceLabel[] =
    rule.mode === "all" && !includeAllLabels
      ? []
      : ((await db.query(
          `SELECT id, name, color FROM label
           WHERE workspace_id = $1 AND task_id IS NULL AND deletion_started_at IS NULL
             ${!includeAllLabels && rule.mode === "labels" ? "AND id = ANY($2::text[])" : ""}
           ORDER BY id ASC`,
          !includeAllLabels && rule.mode === "labels"
            ? [workspaceId, rule.labels]
            : [workspaceId],
        )) as WorkspaceLabel[]);
  if (rule.mode === "all")
    return { predicate: sql`true`, labels, missing: [] };
  const selected = labels.filter((label) => rule.labels.includes(label.id));
  const missing = rule.labels.filter(
    (id) => !selected.some((label) => label.id === id),
  );
  if (missing.length || !selected.length)
    return { predicate: sql`false`, labels, missing };
  const names = joinSql(
    selected.map((label) => sql`${label.name}`),
    ", ",
  );
  const predicate =
    rule.match === "any"
      ? sql`exists (select 1 from label assigned where assigned.task_id = task.id and assigned.workspace_id = ${workspaceId} and assigned.name in (${names}))`
      : sql`(select count(distinct assigned.name) from label assigned where assigned.task_id = task.id and assigned.workspace_id = ${workspaceId} and assigned.name in (${names})) = ${selected.length}::int`;
  return { predicate, labels, missing };
}
