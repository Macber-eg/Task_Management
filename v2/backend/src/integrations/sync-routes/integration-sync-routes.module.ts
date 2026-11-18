import { Module } from "@nestjs/common";
import { TaskModule } from "../../task/task.module";
import { IntegrationSyncController } from "./integration-sync.controller";
import { SyncResumeReviewService } from "./sync-resume-review.service";
import { SyncResumeService } from "./sync-resume.service";
import { SyncRulesService } from "./sync-rules.service";

/** `/api/integration-sync`: sync rule settings and reviewed resumes. */
@Module({
  imports: [TaskModule],
  controllers: [IntegrationSyncController],
  providers: [SyncRulesService, SyncResumeReviewService, SyncResumeService],
})
export class IntegrationSyncRoutesModule {}
