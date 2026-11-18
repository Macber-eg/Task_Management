import { Module } from "@nestjs/common";
import { AssetController } from "./asset/asset.controller";
import { AssetAccessService } from "./asset/asset-access.service";
import { DraftUploadCleanup } from "./cleanup/draft-upload-cleanup.service";
import { OrphanedAssetCleanup } from "./cleanup/orphaned-asset-cleanup.service";
import { StorageCleanupQueue } from "./cleanup/storage-cleanup-queue.service";
import { StorageObjectLock } from "./cleanup/storage-object-lock";
import { ObjectStore } from "./object-store/object-store";
import { S3ObjectStore } from "./object-store/s3-object-store";
import { ProjectBackgroundController } from "./project-background/project-background.controller";
import { ProjectBackgroundService } from "./project-background/project-background.service";
import { ProjectBackgroundReader } from "./project-background/project-background-reader.service";
import { DraftUploadService } from "./task-upload/draft-upload.service";
import { TaskImageUploadService } from "./task-upload/task-image-upload.service";
import { TaskUploadController } from "./task-upload/task-upload.controller";
import { MultipartUploadInterceptor } from "./upload/multipart-upload.interceptor";
import { UploadEntitlementHandler } from "./upload/upload-entitlement.handler";

const shared = [
  StorageObjectLock,
  StorageCleanupQueue,
  DraftUploadCleanup,
  OrphanedAssetCleanup,
];

/**
 * Object storage: asset downloads, uploads through the API, and the cleanup
 * of objects nothing references any more. Other modules use the exported
 * services for copies, orphan cleanup and the cleanup queue.
 */
@Module({
  controllers: [AssetController, TaskUploadController, ProjectBackgroundController],
  providers: [
    ...shared,
    { provide: ObjectStore, useClass: S3ObjectStore },
    UploadEntitlementHandler,
    MultipartUploadInterceptor,
    AssetAccessService,
    TaskImageUploadService,
    DraftUploadService,
    ProjectBackgroundService,
    ProjectBackgroundReader,
  ],
  exports: [...shared, ObjectStore],
})
export class StorageModule {}
