import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { updateReturning } from "../database/dml";
import { ActivityEntity } from "../database/entities/activity.entity";
import { TaskEntity } from "../database/entities/task.entity";
import { EventBus } from "../events/event-bus";
import { OrphanedAssetCleanup } from "../storage/cleanup/orphaned-asset-cleanup.service";

const NOT_FOUND = "Comment not found or you are not the author";

/** Edits a comment on behalf of its author. */
@Injectable()
export class CommentUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly assets: OrphanedAssetCleanup,
  ) {}

  async updateComment(
    userId: string,
    id: string,
    content: string,
  ): Promise<ActivityEntity> {
    const manager = this.dataSource.manager;
    const ownComment = { id, userId, type: "comment" };
    const existing = await manager.findOne(ActivityEntity, {
      where: ownComment,
      select: { id: true, content: true, taskId: true },
    });

    if (!existing) {
      throw new HTTPException(404, { message: NOT_FOUND });
    }

    const [updated] = await updateReturning(
      manager,
      ActivityEntity,
      { content },
      ownComment,
    );

    if (!updated) {
      throw new HTTPException(404, { message: NOT_FOUND });
    }

    const task = await manager.findOne(TaskEntity, {
      where: { id: updated.taskId },
      select: { projectId: true },
    });

    if (task) {
      await this.events.publish("comment.updated", {
        ...updated,
        projectId: task.projectId,
        userId,
      });
    }

    this.assets
      .deleteOrphanedAssets(existing.content, content, {
        taskId: existing.taskId,
      })
      .catch(() => {});

    return updated;
  }
}
