import { createHash } from "node:crypto";
import type { EntityManager } from "typeorm";
import { readSyncRules, type SyncRules } from "../sync/rules";
import { rawSql, runSql, sql } from "../sync/sql-fragment";
import { outgoingPredicate } from "../sync/task-predicate";

type PreviewBinding = {
  id: string;
  projectId: string;
  config: string;
  isActive: boolean | null;
  project: { workspaceId: string };
};

type TaskSample = { id: string; number: number | null; title: string };

const PAUSED = `coalesce(external_link.metadata ~ '"syncFilterPaused"[[:space:]]*:[[:space:]]*true', false)`;
const INITIALIZING = `coalesce(external_link.metadata ~ '"syncInitializationPending"[[:space:]]*:[[:space:]]*true', false)`;

/**
 * The impact of `rules` on the integration's project: counts, a sample of
 * matching tasks, a page of paused links and a token binding the integration,
 * rules, selected labels and the whole task scope.
 */
export async function previewSyncRules(
  db: EntityManager,
  integration: PreviewBinding,
  rules: SyncRules,
  after?: string,
) {
  const proposed = await outgoingPredicate(
    db,
    integration.project.workspaceId,
    rules.outgoing,
    true,
  );
  const current = await outgoingPredicate(
    db,
    integration.project.workspaceId,
    readSyncRules(integration.config)!.outgoing,
  );
  const scope = sql`with sync_scope as (
    select distinct on (task.id)
      task.id as id,
      (${proposed.predicate}) as eligible,
      (${current.predicate}) as is_current,
      external_link.id as link_id,
      external_link.url as url,
      ${rawSql(PAUSED)} as paused,
      ${rawSql(INITIALIZING)} as initializing
    from task
    left join external_link
      on external_link.task_id = task.id
      and external_link.integration_id = ${integration.id}
      and external_link.resource_type = 'issue'
    where task.project_id = ${integration.projectId}
    order by task.id asc, ${rawSql(PAUSED)} desc, external_link.id asc
  )`;
  const [impact] = await runSql<{
    total: number;
    matching: number;
    willCreate: number;
    willPause: number;
    needsReview: number;
    paused: number;
    revision: string;
  }>(
    db,
    sql`${scope}
    select
      count(*)::int as total,
      count(*) filter (where eligible)::int as matching,
      count(*) filter (where eligible and (link_id is null or (initializing and not paused)))::int as "willCreate",
      count(*) filter (where link_id is not null and not eligible and not paused)::int as "willPause",
      count(*) filter (where link_id is not null and eligible and (paused or not is_current))::int as "needsReview",
      count(*) filter (where link_id is not null and (not eligible or paused))::int as paused,
      -- Build the ordered scope revision in PostgreSQL instead of transferring
      -- every task/link to the API just to hash it. Page cursors do not affect it.
      md5(coalesce(string_agg(jsonb_build_array(id, eligible, is_current, link_id, url, paused, initializing)::text, ',' order by id), '')) as revision
    from sync_scope`,
  );
  const matchingTasks = await runSql<TaskSample>(
    db,
    sql`${scope}
    select task.id, task.number, task.title
    from sync_scope inner join task on task.id = sync_scope.id
    where sync_scope.eligible
    order by sync_scope.id asc
    limit 10`,
  );
  const pausedPage = await runSql<
    TaskSample & { linkId: string | null; url: string | null; eligible: boolean }
  >(
    db,
    sql`${scope}
    select task.id, task.number, task.title, sync_scope.link_id as "linkId", sync_scope.url, sync_scope.eligible
    from sync_scope inner join task on task.id = sync_scope.id
    where sync_scope.link_id is not null
      and (not sync_scope.eligible or sync_scope.paused)
      ${after ? sql`and sync_scope.id > ${after}` : sql``}
    order by sync_scope.id asc
    limit 26`,
  );
  const selectedLabelIds =
    rules.outgoing.mode === "labels" ? rules.outgoing.labels : [];
  const previewToken = createHash("sha256")
    .update(
      JSON.stringify({
        integration: [integration.id, integration.config, integration.isActive],
        rules,
        labels: proposed.labels
          .filter((label) => selectedLabelIds.includes(label.id))
          .map(({ id, name }) => [id, name]),
        revision: impact!.revision,
      }),
    )
    .digest("hex");
  const { revision: _, ...counts } = impact!;
  return {
    isActive: integration.isActive === true,
    rules,
    labels: proposed.labels,
    missingLabels: proposed.missing,
    ...counts,
    matchingTasks,
    pausedNextCursor: pausedPage.length > 25 ? pausedPage[24]!.id : null,
    pausedTasks: pausedPage
      .slice(0, 25)
      .flatMap((task) =>
        task.linkId && task.url
          ? [{ ...task, linkId: task.linkId, url: task.url }]
          : [],
      ),
    previewToken,
  };
}
