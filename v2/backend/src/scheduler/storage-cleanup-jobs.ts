import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DraftUploadCleanup } from "../storage/cleanup/draft-upload-cleanup.service";
import { StorageCleanupQueue } from "../storage/cleanup/storage-cleanup-queue.service";
import { JobScheduler } from "./job-scheduler";

/** Schedules the storage module's cleanup passes. */
@Injectable()
export class StorageCleanupJobs implements OnModuleInit {
  constructor(
    private readonly scheduler: JobScheduler,
    private readonly cleanupQueue: StorageCleanupQueue,
    private readonly draftUploads: DraftUploadCleanup,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "storage-cleanup",
      cron: "*/5 * * * *",
      protect: true,
      run: () => this.cleanupQueue.processCleanupQueue(),
    });
    this.scheduler.register({
      name: "draft-upload-cleanup",
      cron: "31 * * * *",
      protect: true,
      run: () => this.draftUploads.cleanupExpiredDraftUploads(),
    });
  }
}
