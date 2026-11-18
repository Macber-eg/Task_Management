import type { EntityManager } from "typeorm";
import { parseLinkMetadata } from "../links/parse-link-metadata";
import { runSql, type SqlFragment, sql } from "./sql-fragment";

/**
 * Marks every unpaused issue link of the integration whose task matches
 * `excluded` (a condition on `task`) as `syncFilterPaused`, in pages of 100
 * locked rows, keeping the rest of each link's metadata.
 */
export async function pauseIssueLinks(
  tx: EntityManager,
  projectId: string,
  integrationId: string,
  excluded: SqlFragment,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const links = await runSql<{ id: string; metadata: string | null }>(
      tx,
      sql`select external_link.id, external_link.metadata
          from external_link
          inner join task on task.id = external_link.task_id
          where external_link.integration_id = ${integrationId}
            and external_link.resource_type = 'issue'
            and task.project_id = ${projectId}
            and ${excluded}
            ${cursor ? sql`and external_link.id > ${cursor}` : sql``}
            and not coalesce(external_link.metadata ~ '"syncFilterPaused"[[:space:]]*:[[:space:]]*true', false)
          order by external_link.id asc
          limit 100
          for update of external_link`,
    );
    if (!links.length) return;
    const values: unknown[] = [new Date()];
    const tuples = links.map((link) => {
      values.push(
        link.id,
        JSON.stringify({
          ...parseLinkMetadata(link.metadata, {
            externalLinkId: link.id,
            source: "sync_pause",
          }),
          syncFilterPaused: true,
        }),
      );
      return `($${values.length - 1}::text, $${values.length}::text)`;
    });
    // Locked rows retain concurrent sync metadata. One update per bounded page
    // replaces a metadata transaction and round trip for every issue link.
    await tx.query(
      `update external_link set metadata = paused.metadata, updated_at = $1
       from (values ${tuples.join(", ")}) as paused(id, metadata)
       where external_link.id = paused.id`,
      values,
    );
    cursor = links.at(-1)!.id;
  }
}
