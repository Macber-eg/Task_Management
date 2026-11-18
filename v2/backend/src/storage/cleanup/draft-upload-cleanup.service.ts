import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { deleteReturning } from "../../database/dml";
import { AssetEntity } from "../../database/entities/asset.entity";
import { StorageCleanupQueue } from "./storage-cleanup-queue.service";

const DRAFT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RUN_BUDGET_MS = 60_000;
const BATCH_SIZE = 500;

/** Staged task attachments that were never submitted expire after a day. */
@Injectable()
export class DraftUploadCleanup {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cleanupQueue: StorageCleanupQueue,
  ) {}

  async cleanupExpiredDraftUploads(): Promise<void> {
    const cutoff = new Date(Date.now() - DRAFT_LIFETIME_MS);
    const deadline = Date.now() + RUN_BUDGET_MS;
    do {
      const count = await this.dataSource.transaction(async (manager) => {
        const batch = (await manager.query(
          `SELECT id FROM asset
           WHERE surface IN ('draft', 'draft-pending')
             AND task_id IS NULL
             AND created_at < $1
           ORDER BY created_at, id
           LIMIT $2
           FOR UPDATE SKIP LOCKED`,
          [cutoff, BATCH_SIZE],
        )) as { id: string }[];
        if (!batch.length) return 0;
        const expired = await deleteReturning(manager, AssetEntity, {
          id: In(batch.map((asset) => asset.id)),
        });
        await this.cleanupQueue.queue(
          manager,
          expired.map((asset) => asset.objectKey),
        );
        return expired.length;
      });
      if (count < BATCH_SIZE) break;
    } while (Date.now() < deadline);
  }
}
