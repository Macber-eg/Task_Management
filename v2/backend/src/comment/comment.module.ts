import { Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { StorageModule } from "../storage/storage.module";
import { CommentController } from "./comment.controller";
import { CommentCreationService } from "./comment-creation.service";
import { CommentDeletionService } from "./comment-deletion.service";
import { CommentQueryService } from "./comment-query.service";
import { CommentUpdateService } from "./comment-update.service";

const writers = [
  CommentCreationService,
  CommentUpdateService,
  CommentDeletionService,
];

/** Comments are activities of type `comment`; the activity routes reuse the writers. */
@Module({
  imports: [NotificationModule, StorageModule],
  controllers: [CommentController],
  providers: [CommentQueryService, ...writers],
  exports: writers,
})
export class CommentModule {}
