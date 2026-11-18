import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { insertReturning } from "../../database/dml";
import { AssetEntity } from "../../database/entities/asset.entity";
import { ProjectEntity } from "../../database/entities/project.entity";
import { StorageObjectLock } from "../cleanup/storage-object-lock";
import { isImageContentType } from "../object-store/image-content-types";
import { buildStorageObjectKey } from "../object-store/object-keys";
import { ObjectStore } from "../object-store/object-store";
import { putUpload } from "../upload/put-upload";
import type { ValidatedUpload } from "../upload/validate-upload";

/**
 * Attachments uploaded before their task exists. They stay private to the
 * uploader until a task submission claims them, and expire after a day.
 */
@Injectable()
export class DraftUploadService {
  private readonly logger = new Logger(DraftUploadService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lock: StorageObjectLock,
    private readonly store: ObjectStore,
  ) {}

  async stage(
    projectId: string,
    userId: string,
    upload: ValidatedUpload,
  ): Promise<AssetEntity> {
    const project = await this.dataSource.manager.findOne(ProjectEntity, {
      select: { id: true, workspaceId: true },
      where: { id: projectId },
    });
    if (!project) throw new HTTPException(404, { message: "Project not found" });

    const key = buildStorageObjectKey({
      workspaceId: project.workspaceId,
      projectId,
      taskId: `draft-${userId}`,
      surface: "description",
      filename: upload.filename,
    });

    return this.lock.withUploadedObject(
      key,
      () => putUpload(this.store, this.logger, key, upload),
      async (manager) => {
        // Recorded in the project's current workspace, should it have moved.
        const [current] = (await manager.query(
          "SELECT workspace_id AS \"workspaceId\" FROM project WHERE id = $1 FOR SHARE",
          [projectId],
        )) as { workspaceId: string }[];
        if (!current)
          throw new HTTPException(404, { message: "Project not found" });
        const asset = await insertReturning(manager, AssetEntity, {
          workspaceId: current.workspaceId,
          projectId,
          taskId: null,
          objectKey: key,
          filename: upload.filename,
          mimeType: upload.contentType,
          size: upload.size,
          kind: isImageContentType(upload.contentType) ? "image" : "attachment",
          surface: "draft",
          createdBy: userId,
        });
        if (!asset)
          throw new HTTPException(500, { message: "Failed to save asset" });
        return asset;
      },
    );
  }
}
