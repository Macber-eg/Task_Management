import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { JobLeaseEntity } from "../../database/entities/job-lease.entity";
import { StorageCleanupEntity } from "../../database/entities/storage-cleanup.entity";
import { ObjectStore } from "../object-store/object-store";
import { StorageObjectLock, verificationLeaseName } from "./storage-object-lock";

const BATCH_SIZE = 100;
const INSERT_CHUNK = 500;

type ProviderFailure = {
  name?: string;
  code?: string;
  $metadata?: { httpStatusCode?: number };
} | null;

/**
 * Objects whose last reference is gone wait in `storage_cleanup` (filled by
 * this service and by the `asset` / `project` delete triggers) until the
 * bucket confirms their deletion.
 */
@Injectable()
export class StorageCleanupQueue {
  private readonly logger = new Logger(StorageCleanupQueue.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lock: StorageObjectLock,
    private readonly store: ObjectStore,
  ) {}

  /** Queues keys inside the caller's transaction. */
  async queue(manager: EntityManager, keys: string[]): Promise<void> {
    const uniqueKeys = [...new Set(keys)];
    for (let offset = 0; offset < uniqueKeys.length; offset += INSERT_CHUNK) {
      await manager.query(
        `INSERT INTO storage_cleanup (object_key)
         SELECT unnest($1::text[])
         ON CONFLICT (object_key) DO NOTHING`,
        [uniqueKeys.slice(offset, offset + INSERT_CHUNK)],
      );
    }
  }

  /**
   * One pass over the queue, run on a schedule. Never-attempted and failed
   * objects take turns, so neither a backlog of new keys nor a batch of
   * permanent failures starves the other.
   */
  async processCleanupQueue(): Promise<{ degraded: boolean }> {
    const pending = (await this.dataSource.query(
      `SELECT ranked.object_key AS "objectKey"
       FROM (
         SELECT object_key, last_attempt_at,
           row_number() OVER (
             PARTITION BY last_attempt_at IS NULL
             ORDER BY coalesce(last_attempt_at, created_at), object_key
           ) AS cleanup_rank
         FROM storage_cleanup
       ) AS ranked
       ORDER BY ranked.cleanup_rank, ranked.last_attempt_at, ranked.object_key
       LIMIT $1`,
      [BATCH_SIZE],
    )) as { objectKey: string }[];

    let degraded = false;
    for (const item of pending) {
      if (!(await this.processKey(item.objectKey))) degraded = true;
    }
    return { degraded };
  }

  /**
   * Deletes one queued object unless it is referenced again or being
   * verified. False when the bucket refused; the key stays queued.
   */
  processKey(objectKey: string): Promise<boolean> {
    return this.lock.withObject(objectKey, async (manager) => {
      const queued = await manager.findOne(StorageCleanupEntity, {
        where: { objectKey },
      });
      if (!queued) return true;
      const verification = await manager.findOne(JobLeaseEntity, {
        where: { name: verificationLeaseName(objectKey) },
      });
      if (verification && verification.expiresAt > new Date()) return true;

      const assets = (await manager.query(
        "SELECT id FROM asset WHERE object_key = $1 FOR KEY SHARE",
        [objectKey],
      )) as unknown[];
      const backgrounds = (await manager.query(
        "SELECT id FROM project WHERE background_object_key = $1 FOR KEY SHARE",
        [objectKey],
      )) as unknown[];
      if (assets.length > 0 || backgrounds.length > 0) {
        await manager.delete(StorageCleanupEntity, { objectKey });
        return true;
      }

      try {
        await this.store.delete(objectKey);
        await manager.delete(StorageCleanupEntity, { objectKey });
        return true;
      } catch (error) {
        // Provider identifiers diagnose failures without exposing uploaded paths.
        const failure = error as ProviderFailure;
        this.logger.error("Storage cleanup failed", {
          name: failure?.name,
          code: failure?.code,
          status: failure?.$metadata?.httpStatusCode,
        });
        await manager.update(
          StorageCleanupEntity,
          { objectKey },
          { lastAttemptAt: new Date() },
        );
        return false;
      }
    });
  }
}
