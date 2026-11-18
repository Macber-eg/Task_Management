import type { EntityManager } from "typeorm";
import { insertReturning } from "../../database/dml";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import { findExternalLink } from "./external-link-queries";
import {
  applyLinkMetadataChanges,
  hasMetadataChanges,
  type LinkMetadata,
  type LinkMetadataChanges,
} from "./link-metadata-update";
import { parseLinkMetadata } from "./parse-link-metadata";

export type CreateExternalLinkParams = {
  taskId: string;
  integrationId: string;
  resourceType: "issue" | "pull_request" | "branch";
  externalId: string;
  url: string;
  title?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpdateExternalLinkParams = LinkMetadataChanges & {
  title?: string | null;
  url?: string;
};

function inTransaction(db: EntityManager): boolean {
  return db.queryRunner?.isTransactionActive === true;
}

/** Fails unless the task still belongs to the integration's project. */
export async function createExternalLink(
  db: EntityManager,
  params: CreateExternalLinkParams,
): Promise<{ id: string }> {
  if (!inTransaction(db)) {
    return db.transaction((tx) => createExternalLink(tx, params));
  }
  const task = (await db.query(
    `SELECT task.id FROM task
     INNER JOIN integration ON integration.project_id = task.project_id
     WHERE task.id = $1 AND integration.id = $2
     FOR SHARE OF task`,
    [params.taskId, params.integrationId],
  )) as unknown[];
  if (!task.length)
    throw new Error("Task no longer belongs to the integration project");

  const link = await insertReturning(db, ExternalLinkEntity, {
    taskId: params.taskId,
    integrationId: params.integrationId,
    resourceType: params.resourceType,
    externalId: params.externalId,
    url: params.url,
    title: params.title ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });
  if (!link) {
    throw new Error("Failed to create external link");
  }
  return { id: link.id };
}

/**
 * Updates title/url and merges sync metadata under a row lock (see
 * `applyLinkMetadataChanges`). Answers false when the link is gone or nothing
 * was given to change.
 */
export async function updateExternalLink(
  db: EntityManager,
  id: string,
  params: UpdateExternalLinkParams,
): Promise<boolean> {
  if (hasMetadataChanges(params)) {
    return db.transaction(async (tx) => {
      const link = await lockExternalLink(tx, id);
      if (!link) return false;
      const metadata = parseLinkMetadata<LinkMetadata>(link.metadata, {
        externalLinkId: id,
        source: "sync_update",
      });
      const merged = applyLinkMetadataChanges(
        metadata as LinkMetadata,
        params,
      );
      const set = ["metadata = $2", "updated_at = $3"];
      const values: unknown[] = [id, JSON.stringify(merged), new Date()];
      if (params.title !== undefined) {
        values.push(params.title);
        set.push(`title = $${values.length}`);
      }
      if (params.url !== undefined) {
        values.push(params.url);
        set.push(`url = $${values.length}`);
      }
      await tx.query(
        `UPDATE external_link SET ${set.join(", ")} WHERE id = $1`,
        values,
      );
      return true;
    });
  }
  const set: string[] = [];
  const values: unknown[] = [id];
  if (params.title !== undefined) {
    values.push(params.title);
    set.push(`title = $${values.length}`);
  }
  if (params.url !== undefined) {
    values.push(params.url);
    set.push(`url = $${values.length}`);
  }
  if (!set.length) return false;
  values.push(new Date());
  set.push(`updated_at = $${values.length}`);
  const [rows] = (await db.query(
    `UPDATE external_link SET ${set.join(", ")} WHERE id = $1 RETURNING id`,
    values,
  )) as [unknown[], number];
  return rows.length > 0;
}

export async function createOrUpdateExternalLink(
  db: EntityManager,
  params: CreateExternalLinkParams,
): Promise<{ id: string; created: boolean }> {
  const existing = await findExternalLink(
    db,
    params.integrationId,
    params.resourceType,
    params.externalId,
  );

  if (existing) {
    await updateExternalLink(db, existing.id, {
      title: params.title,
      url: params.url,
      metadata: params.metadata,
    });
    return { id: existing.id, created: false };
  }

  const link = await createExternalLink(db, params);
  return { id: link.id, created: true };
}

export async function deleteExternalLink(
  db: EntityManager,
  id: string,
): Promise<void> {
  await db.query(`DELETE FROM external_link WHERE id = $1`, [id]);
}

export async function lockExternalLink(
  db: EntityManager,
  id: string,
): Promise<{ id: string; metadata: string | null } | undefined> {
  const [link] = (await db.query(
    `SELECT id, metadata FROM external_link WHERE id = $1 FOR UPDATE`,
    [id],
  )) as { id: string; metadata: string | null }[];
  return link;
}
