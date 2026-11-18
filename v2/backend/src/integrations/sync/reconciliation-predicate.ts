import { type SqlFragment, sql } from "./sql-fragment";

/**
 * Tasks (as `task`) that reconciliation must visit for one integration:
 * matching tasks without an issue (or with one still initializing), and
 * excluded tasks whose issue link is not paused yet.
 */
export function reconciliationPredicate(
  integrationId: string,
  outgoing: SqlFragment,
): SqlFragment {
  const linked = sql`exists (
    select 1 from external_link scoped_link
    where scoped_link.task_id = task.id
      and scoped_link.integration_id = ${integrationId}
      and scoped_link.resource_type = 'issue'
  )`;
  const pending = sql`exists (
    select 1 from external_link scoped_link
    where scoped_link.task_id = task.id
      and scoped_link.integration_id = ${integrationId}
      and scoped_link.resource_type = 'issue'
      and scoped_link.metadata ~ '"syncInitializationPending"[[:space:]]*:[[:space:]]*true'
      and not coalesce(scoped_link.metadata ~ '"syncFilterPaused"[[:space:]]*:[[:space:]]*true', false)
  )`;
  const unpaused = sql`exists (
    select 1 from external_link scoped_link
    where scoped_link.task_id = task.id
      and scoped_link.integration_id = ${integrationId}
      and scoped_link.resource_type = 'issue'
      and not coalesce(scoped_link.metadata ~ '"syncFilterPaused"[[:space:]]*:[[:space:]]*true', false)
  )`;
  // Label renames and reconnects also use reconciliation, so excluded links
  // still need pausing even when no rule-save transaction ran beforehand.
  return sql`((${outgoing} and (not ${linked} or ${pending})) or (not (${outgoing}) and ${unpaused}))`;
}
