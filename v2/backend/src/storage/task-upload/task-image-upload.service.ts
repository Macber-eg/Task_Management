import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { insertReturning } from "../../database/dml";
import { AssetEntity } from "../../database/entities/asset.entity";
import { StorageObjectLock } from "../cleanup/storage-object-lock";
import { isImageContentType } from "../object-store/image-content-types";
import {
  buildStorageObjectKey,
  type UploadSurface,
} from "../object-store/object-keys";
import { ObjectStore } from "../object-store/object-store";
import { putUpload } from "../upload/put-upload";
import type { ValidatedUpload } from "../upload/validate-upload";

type TaskScope = { projectId: string; workspaceId: string };

function findTaskScope(
  manager: EntityManager,
  taskId: string,
  lock = "",
): Promise<TaskScope[]> {
  return manager.query(
    `SELECT t.project_id AS "projectId", p.workspace_id AS "workspaceId"
     FROM task AS t
     INNER JOIN project AS p ON t.project_id = p.id
     WHERE t.id = $1
     LIMIT 1 ${lock}`,
    [taskId],
  ) as Promise<TaskScope[]>;
}

/** Images and attachments embedded in a task's description or comments. */
@Injectable()
export class TaskImageUploadService {
  private readonly logger = new Logger(TaskImageUploadService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lock: StorageObjectLock,
    private readonly store: ObjectStore,
  ) {}

  async upload(
    taskId: string,
    userId: string,
    surface: UploadSurface,
    upload: ValidatedUpload,
  ): Promise<AssetEntity> {
    const [scope] = await findTaskScope(this.dataSource.manager, taskId);
    if (!scope) throw new HTTPException(404, { message: "Task not found" });

    const key = buildStorageObjectKey({
      ...scope,
      taskId,
      surface,
      filename: upload.filename,
    });

    return this.lock.withUploadedObject(
      key,
      () => putUpload(this.store, this.logger, key, upload),
      async (manager) => {
        // The task may have moved while the bytes were sent; the asset
        // follows its current project, the key stays the issued one.
        const [current] = await findTaskScope(manager, taskId, "FOR KEY SHARE OF t");
        if (!current) throw new HTTPException(404, { message: "Task not found" });
        const asset = await insertReturning(manager, AssetEntity, {
          workspaceId: current.workspaceId,
          projectId: current.projectId,
          taskId,
          objectKey: key,
          filename: upload.filename,
          mimeType: upload.contentType,
          size: upload.size,
          kind: isImageContentType(upload.contentType) ? "image" : "attachment",
          surface,
          createdBy: userId,
        });
        if (!asset)
          throw new HTTPException(500, { message: "Failed to save asset" });
        return asset;
      },
    );
  }
}
