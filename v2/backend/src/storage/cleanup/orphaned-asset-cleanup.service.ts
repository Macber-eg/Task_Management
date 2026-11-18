import { Injectable, Logger } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { AssetEntity } from "../../database/entities/asset.entity";
import { ObjectStore } from "../object-store/object-store";
import { contentReferencesAsset, extractAssetIds } from "./asset-references";

/**
 * Removes a task's assets once an edit drops their last reference from the
 * task's description, comments and activity.
 */
@Injectable()
export class OrphanedAssetCleanup {
  private readonly logger = new Logger(OrphanedAssetCleanup.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly store: ObjectStore,
  ) {}

  async deleteOrphanedAssets(
    oldContent: string | null | undefined,
    newContent: string | null | undefined,
    scope: { taskId: string },
  ): Promise<void> {
    const newIds = extractAssetIds(newContent);
    const removedIds = [...extractAssetIds(oldContent)].filter(
      (id) => !newIds.has(id),
    );
    if (removedIds.length === 0) return;

    const assets = await this.dataSource.manager.find(AssetEntity, {
      select: { id: true, objectKey: true },
      where: { id: In(removedIds), taskId: scope.taskId },
    });

    const assetsToDelete: AssetEntity[] = [];
    for (const asset of assets) {
      if (!(await this.isReferencedElsewhere(asset.id, scope.taskId))) {
        assetsToDelete.push(asset);
      }
    }
    if (assetsToDelete.length === 0) return;

    const results = await this.deleteObjects(
      assetsToDelete.map((asset) => asset.objectKey),
    );
    const deletedIds = assetsToDelete
      .filter((_, index) => results[index]?.status === "fulfilled")
      .map((asset) => asset.id);
    if (deletedIds.length === 0) return;

    await this.dataSource.manager.delete(AssetEntity, { id: In(deletedIds) });
  }

  async getTaskAssetKeys(taskId: string): Promise<string[]> {
    const assets = await this.dataSource.manager.find(AssetEntity, {
      select: { objectKey: true },
      where: { taskId },
    });
    return assets.map((asset) => asset.objectKey);
  }

  /** Deletes objects one by one; failures are logged, not thrown. */
  async deleteObjects(keys: string[]): Promise<PromiseSettledResult<void>[]> {
    const results = await Promise.allSettled(
      keys.map((key) => this.store.delete(key)),
    );
    const failed = keys
      .map((key, index) => ({ key, result: results[index] }))
      .filter(
        (entry): entry is { key: string; result: PromiseRejectedResult } =>
          entry.result?.status === "rejected",
      );
    if (failed.length > 0) {
      this.logger.error(
        "Failed to delete S3 objects",
        failed.map(({ key, result }) => ({ key, reason: result.reason })),
      );
    }
    return results;
  }

  private async isReferencedElsewhere(
    assetId: string,
    taskId: string,
  ): Promise<boolean> {
    const pattern = `%/api/asset/${assetId}%`;
    const manager = this.dataSource.manager;

    const tasks = (await manager.query(
      "SELECT description FROM task WHERE id = $1 AND description LIKE $2 LIMIT 1",
      [taskId, pattern],
    )) as { description: string | null }[];
    if (contentReferencesAsset(tasks[0]?.description, assetId)) return true;

    const comments = (await manager.query(
      "SELECT content FROM comment WHERE task_id = $1 AND content LIKE $2",
      [taskId, pattern],
    )) as { content: string | null }[];
    if (comments.some((row) => contentReferencesAsset(row.content, assetId)))
      return true;

    const activities = (await manager.query(
      "SELECT content FROM activity WHERE task_id = $1 AND content LIKE $2",
      [taskId, pattern],
    )) as { content: string | null }[];
    return activities.some((row) =>
      contentReferencesAsset(row.content, assetId),
    );
  }
}
