import { Injectable } from "@nestjs/common";
import { OrphanedAssetCleanup } from "../../storage/cleanup/orphaned-asset-cleanup.service";
import { buildStorageObjectKey } from "../../storage/object-store/object-keys";
import { ObjectStore } from "../../storage/object-store/object-store";
import { type TaskAssetCopy, TaskAssetStorage } from "./task-asset-storage";

/** Task asset storage backed by the storage module's bucket. */
@Injectable()
export class ObjectStoreTaskAssetStorage extends TaskAssetStorage {
  constructor(
    private readonly store: ObjectStore,
    private readonly orphans: OrphanedAssetCleanup,
  ) {
    super();
  }

  async copyTaskAssetObject({
    sourceKey,
    destination,
  }: TaskAssetCopy): Promise<string> {
    const key = buildStorageObjectKey(destination);
    await this.store.copy(sourceKey, key);
    return key;
  }

  deleteObject(objectKey: string): Promise<void> {
    return this.store.delete(objectKey);
  }

  deleteOrphanedAssets(
    oldContent: string | null | undefined,
    newContent: string | null | undefined,
    scope: { taskId: string },
  ): Promise<void> {
    return this.orphans.deleteOrphanedAssets(oldContent, newContent, scope);
  }
}
