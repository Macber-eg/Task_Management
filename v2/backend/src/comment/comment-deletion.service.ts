import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { deleteReturning } from "../database/dml";
import { ActivityEntity } from "../database/entities/activity.entity";
import { TaskEntity } from "../database/entities/task.entity";
import { EventBus } from "../events/event-bus";
import { OrphanedAssetCleanup } from "../storage/cleanup/orphaned-asset-cleanup.service";

const NOT_FOUND = "Comment not found or you are not the author";

/** Deletes a comment on behalf of its author. */
@Injectable()
export class CommentDeletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly assets: OrphanedAssetCleanup,
  ) {}

  async deleteComment(userId: string, id: string): Promise<ActivityEntity> {
    const manager = this.dataSource.manager;
    const ownComment = { id, userId, type: "comment" };
    const existing = await manager.findOne(ActivityEntity, {
      where: ownComment,
      select: { id: true, content: true, taskId: true },
    });

    if (!existing) {
      throw new HTTPException(404, { message: NOT_FOUND });
    }

    const [deletedComment] = await deleteReturning(
      manager,
      ActivityEntity,
      ownComment,
    );

    if (!deletedComment) {
      throw new HTTPException(404, { message: NOT_FOUND });
    }

    const task = await manager.findOne(TaskEntity, {
      where: { id: deletedComment.taskId },
      select: { projectId: true },
    });

    if (task) {
      await this.events.publish("comment.deleted", {
        ...deletedComment,
        projectId: task.projectId,
        userId,
      });
    }

    this.assets
      .deleteOrphanedAssets(existing.content, null, {
        taskId: existing.taskId,
      })
      .catch(() => {});

    return deletedComment;
  }
}
