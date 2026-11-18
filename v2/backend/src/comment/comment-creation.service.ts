import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { insertReturning } from "../database/dml";
import { ActivityEntity } from "../database/entities/activity.entity";
import { EventBus } from "../events/event-bus";
import { NotificationCreationService } from "../notification/notification-creation.service";
import { parseMentionIds } from "./parse-mention-ids";

export type ExternalAuthor = { userName: string; source: string };

type CommentedTask = {
  assigneeId: string | null;
  projectId: string;
  title: string;
  workspaceId: string;
};

/** Adds comments (stored as `comment` activities) and notifies about them. */
@Injectable()
export class CommentCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly notifications: NotificationCreationService,
  ) {}

  async createComment(
    taskId: string,
    userId: string,
    content: string,
    external?: ExternalAuthor,
  ): Promise<ActivityEntity> {
    const manager = this.dataSource.manager;
    const activity = await insertReturning(manager, ActivityEntity, {
      taskId,
      type: "comment",
      userId,
      content,
      ...(external
        ? {
            externalUserName: external.userName,
            externalSource: external.source,
          }
        : {}),
    });

    if (!activity) {
      throw new HTTPException(500, {
        message: "Failed to create activity",
      });
    }

    const [user] = (await manager.query(
      `SELECT name FROM "user" WHERE id = $1`,
      [userId],
    )) as { name: string }[];

    const [task] = (await manager.query(
      `SELECT t.assignee_id AS "assigneeId", t.project_id AS "projectId",
              t.title, p.workspace_id AS "workspaceId"
       FROM task AS t
       INNER JOIN project AS p ON t.project_id = p.id
       WHERE t.id = $1`,
      [taskId],
    )) as CommentedTask[];

    if (task) {
      await this.events.publish("comment.created", {
        ...activity,
        comment: `**${user?.name}** commented:\n> ${content}`,
        projectId: task.projectId,
      });
    }

    // Notify any workspace members @mentioned in the comment (not the author).
    const mentionedIds = parseMentionIds(content).filter((id) => id !== userId);
    for (const mentionedId of mentionedIds) {
      await this.notifications.createNotification({
        userId: mentionedId,
        type: "task_mention",
        eventData: {
          taskTitle: task?.title ?? null,
          mentionerName: user?.name ?? null,
          projectId: task?.projectId ?? null,
          workspaceId: task?.workspaceId ?? null,
        },
        resourceId: taskId,
        resourceType: "task",
      });
    }

    if (
      task?.assigneeId &&
      task.assigneeId !== userId &&
      !mentionedIds.includes(task.assigneeId)
    ) {
      await this.notifications.createNotification({
        userId: task.assigneeId,
        type: "task_comment",
        eventData: {
          taskTitle: task.title,
          commenterName: user?.name ?? null,
          commentPreview: content.slice(0, 160),
          projectId: task.projectId,
          workspaceId: task.workspaceId,
        },
        resourceId: taskId,
        resourceType: "task",
      });
    }

    return activity;
  }
}
