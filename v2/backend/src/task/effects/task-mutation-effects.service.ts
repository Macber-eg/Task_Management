import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { createActivities } from "../../activity/create-activities";
import { EventBus } from "../../events/event-bus";
import { NotificationCreationService } from "../../notification/notification-creation.service";
import { TaskAssetStorage } from "../seams/task-asset-storage";
import { parseMentionIds } from "../shared/parse-mention-ids";
import { getSubtaskParentProjects } from "../shared/subtask-parent-projects";
import type { TaskRow } from "../shared/task-row";

type TrackedField =
  | "title"
  | "status"
  | "priority"
  | "description"
  | "userId"
  | "dueDate"
  | "phaseId"
  | "sprintId";

type Changes = Partial<Pick<TaskRow, TrackedField>>;

export type TaskBefore = Pick<
  TaskRow,
  "id" | "projectId" | "title" | "status" | "priority" | "userId" | "dueDate"
> & {
  description?: string | null;
  columnId?: string | null;
  phaseId?: string | null;
  sprintId?: string | null;
};

export type PublishTaskMutationOptions = {
  skipSubtaskParentRefresh?: boolean;
  skipRelationRefresh?: boolean;
  fields?: TrackedField[];
  assigneeName?: string | null;
  sourceIntegrationId?: string;
};

/**
 * What every task write does besides the write: the audit rows that must
 * commit with it, and the events (activity, notifications, live boards,
 * integrations) published once it has committed.
 */
@Injectable()
export class TaskMutationEffects {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly notifications: NotificationCreationService,
    private readonly storage: TaskAssetStorage,
  ) {}

  /** Runs inside the write's transaction. */
  async recordTaskMutation(
    tx: EntityManager,
    before: TaskBefore,
    changes: Changes,
    userId?: string,
  ): Promise<void> {
    if (changes.title !== undefined && before.title !== changes.title) {
      await createActivities(tx, [
        {
          taskId: before.id,
          type: "title_changed",
          userId: userId ?? null,
          content: null,
          eventData: { oldTitle: before.title, newTitle: changes.title },
        },
      ]);
    }
    if (
      changes.dueDate !== undefined &&
      before.dueDate?.getTime() !== changes.dueDate?.getTime()
    ) {
      await tx.query(`DELETE FROM task_reminder_sent WHERE task_id = $1`, [
        before.id,
      ]);
    }
  }

  async publishTaskMutation(
    before: Partial<TaskBefore>,
    after: Pick<TaskBefore, "id" | "projectId" | "title"> & Partial<TaskBefore>,
    userId?: string,
    options: PublishTaskMutationOptions = {},
  ): Promise<void> {
    const changed = (field: TrackedField) =>
      (!options.fields || options.fields.includes(field)) &&
      before[field] !== after[field];
    const common = {
      taskId: after.id,
      projectId: after.projectId,
      userId,
      title: after.title,
      ...(options.sourceIntegrationId
        ? { sourceIntegrationId: options.sourceIntegrationId }
        : {}),
    };
    if (changed("status")) {
      await this.events.publish("task.status_changed", {
        ...common,
        oldStatus: before.status,
        newStatus: after.status,
        assigneeId: after.userId,
        type: "status_changed",
        ...(options.skipSubtaskParentRefresh
          ? { skipSubtaskParentRefresh: true }
          : {}),
      });
    }
    const columnChanged =
      (!options.fields || options.fields.includes("status")) &&
      before.columnId !== undefined &&
      after.columnId !== undefined &&
      before.columnId !== after.columnId;
    if (
      columnChanged &&
      !changed("status") &&
      !options.skipSubtaskParentRefresh
    )
      await this.events.publish("subtask-parents.refresh", {
        projects: await getSubtaskParentProjects(this.dataSource.manager, [
          after.id,
        ]),
      });
    if (!options.skipRelationRefresh && (changed("status") || columnChanged))
      await this.events.publish("task-relation.refresh", {
        projectId: after.projectId,
        userId,
      });
    if (changed("title"))
      await this.events.publish("task.title_changed", {
        ...common,
        oldTitle: before.title,
        newTitle: after.title,
        type: "title_changed",
      });
    if (changed("priority"))
      await this.events.publish("task.priority_changed", {
        ...common,
        oldPriority: before.priority,
        newPriority: after.priority,
        type: "priority_changed",
      });
    if (changed("userId")) {
      const assignee =
        options.assigneeName !== undefined
          ? { name: options.assigneeName ?? undefined }
          : after.userId
            ? await this.findUserName(after.userId)
            : undefined;
      await this.events.publish(
        after.userId ? "task.assignee_changed" : "task.unassigned",
        {
          ...common,
          oldAssignee: before.userId,
          newAssignee: assignee?.name,
          newAssigneeId: after.userId,
          type: after.userId ? "assignee_changed" : "unassigned",
        },
      );
    }
    if (
      (!options.fields || options.fields.includes("dueDate")) &&
      before.dueDate?.getTime() !== after.dueDate?.getTime()
    )
      await this.events.publish("task.due_date_changed", {
        ...common,
        oldDueDate: before.dueDate,
        newDueDate: after.dueDate,
        type: "due_date_changed",
      });
    if (
      (!options.fields || options.fields.includes("description")) &&
      before.description !== undefined &&
      before.description !== after.description
    ) {
      await this.events.publish("task.description_changed", {
        ...common,
        oldDescription: before.description,
        newDescription: after.description,
        type: "description_changed",
      });
      this.storage
        .deleteOrphanedAssets(before.description, after.description, {
          taskId: after.id,
        })
        .catch(() => {});
      await this.notifyNewMentions(
        before.description,
        after.description,
        after,
        userId,
      );
    }
  }

  private async notifyNewMentions(
    oldDescription: string | null,
    newDescription: string | null | undefined,
    task: { id: string; title: string },
    userId?: string,
  ): Promise<void> {
    const oldMentions = new Set(parseMentionIds(oldDescription));
    const newlyMentioned = parseMentionIds(newDescription).filter(
      (id) => id !== userId && !oldMentions.has(id),
    );
    if (!newlyMentioned.length) return;
    const editor = userId ? await this.findUserName(userId) : undefined;
    for (const mentionedId of newlyMentioned)
      await this.notifications.createNotification({
        userId: mentionedId,
        type: "task_mention",
        eventData: {
          taskTitle: task.title,
          mentionerName: editor?.name ?? null,
        },
        resourceId: task.id,
        resourceType: "task",
      });
  }

  private async findUserName(id: string) {
    const [user] = (await this.dataSource.query(
      `SELECT name FROM "user" WHERE id = $1 LIMIT 1`,
      [id],
    )) as { name: string }[];
    return user;
  }
}
