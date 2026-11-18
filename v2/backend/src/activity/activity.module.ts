import { Module } from "@nestjs/common";
import { CommentModule } from "../comment/comment.module";
import { ActivityController } from "./activity.controller";
import { ActivityEventSubscriber } from "./activity-event-subscriber";
import { ActivityQueryService } from "./activity-query.service";
import { WorkspaceActivityService } from "./workspace-activity.service";

@Module({
  imports: [CommentModule],
  controllers: [ActivityController],
  providers: [
    ActivityQueryService,
    WorkspaceActivityService,
    ActivityEventSubscriber,
  ],
})
export class ActivityModule {}
