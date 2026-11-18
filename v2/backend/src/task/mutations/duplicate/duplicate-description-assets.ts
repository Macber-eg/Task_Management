import { Logger } from "@nestjs/common";
import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import type { AssetEntity } from "../../../database/entities/asset.entity";
import type { TaskAssetStorage } from "../../seams/task-asset-storage";
import { contentReferencesAsset } from "../../../storage/cleanup/asset-references";
import type { TaskRow } from "../../shared/task-row";

export type AssetCopy = Pick<
  AssetEntity,
  | "id"
  | "workspaceId"
  | "projectId"
  | "taskId"
  | "objectKey"
  | "filename"
  | "mimeType"
  | "size"
  | "kind"
  | "surface"
  | "createdBy"
>;

const logger = new Logger("DuplicateTask");

export async function discardCopiedObjects(
  storage: TaskAssetStorage,
  objectKeys: string[],
) {
  await Promise.all(
    objectKeys.map((objectKey) =>
      storage.deleteObject(objectKey).catch((error: unknown) => {
        logger.error("Failed to discard a duplicated task asset:", error);
      }),
    ),
  );
}

/**
 * Assets are addressed by `/api/asset/<id>` inside the description, so the
 * copy needs its own asset rows and stored objects. Sharing the source rows
 * is not an option: `asset.objectKey` is unique and deleting the source task
 * cascades to them.
 */
export async function duplicateDescriptionAssets(
  manager: EntityManager,
  storage: TaskAssetStorage,
  {
    sourceTask,
    duplicatedTaskId,
    workspaceId,
  }: { sourceTask: TaskRow; duplicatedTaskId: string; workspaceId: string },
): Promise<{ assets: AssetCopy[]; description: string | null }> {
  const description = sourceTask.description;

  if (!description) {
    return { assets: [], description };
  }

  const sourceAssets = (await manager.query(
    `SELECT id, object_key AS "objectKey", filename, mime_type AS "mimeType",
       size, kind, surface, created_by AS "createdBy"
     FROM asset WHERE task_id = $1 AND project_id = $2 AND workspace_id = $3`,
    [sourceTask.id, sourceTask.projectId, workspaceId],
  )) as Omit<AssetCopy, "workspaceId" | "projectId" | "taskId">[];

  const referencedAssets = sourceAssets.filter((asset) =>
    contentReferencesAsset(description, asset.id),
  );

  const assets: AssetCopy[] = [];
  let duplicatedDescription = description;

  try {
    for (const asset of referencedAssets) {
      const duplicatedAssetId = createId();
      const objectKey = await storage.copyTaskAssetObject({
        sourceKey: asset.objectKey,
        destination: {
          workspaceId,
          projectId: sourceTask.projectId,
          taskId: duplicatedTaskId,
          surface: asset.surface === "comment" ? "comment" : "description",
          filename: asset.filename,
          contentType: asset.mimeType,
        },
      });

      assets.push({
        id: duplicatedAssetId,
        workspaceId,
        projectId: sourceTask.projectId,
        taskId: duplicatedTaskId,
        objectKey,
        filename: asset.filename,
        mimeType: asset.mimeType,
        size: asset.size,
        kind: asset.kind,
        surface: asset.surface,
        createdBy: asset.createdBy,
      });

      duplicatedDescription = duplicatedDescription.replaceAll(
        `/api/asset/${asset.id}`,
        `/api/asset/${duplicatedAssetId}`,
      );
    }
  } catch (error) {
    await discardCopiedObjects(
      storage,
      assets.map((asset) => asset.objectKey),
    );

    logger.error("Failed to copy task attachments:", error);
    throw new HTTPException(503, {
      message: "Failed to copy the task attachments",
    });
  }

  return { assets, description: duplicatedDescription };
}
