import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { EventBus } from "../events/event-bus";
import { createActivity } from "./create-activity";

type TaskEvent = { taskId: string; userId: string; type: string };

/** Writes the task activity feed from the task events. */
@Injectable()
export class ActivityEventSubscriber implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    const record = (
      taskId: string,
      type: string,
      userId: string,
      eventData: Record<string, unknown>,
    ) =>
      createActivity(
        this.dataSource.manager,
        taskId,
        type,
        userId,
        null,
        eventData,
      );

    this.events.subscribe<{
      taskId: string;
      currentUserId: string;
      type: string;
      content: string | null;
    }>("task.created", async (data) => {
      if (!data.currentUserId || !data.taskId || !data.type) {
        return;
      }
      await record(data.taskId, data.type, data.currentUserId, {});
    });

    this.events.subscribe<
      TaskEvent & {
        fromProjectId: string;
        fromProjectName: string;
        toProjectId: string;
        toProjectName: string;
        oldStatus: string;
        newStatus: string;
      }
    >("task.moved", async (data) => {
      const {
        fromProjectId,
        fromProjectName,
        toProjectId,
        toProjectName,
        oldStatus,
        newStatus,
      } = data;
      await record(data.taskId, data.type, data.userId, {
        fromProjectId,
        fromProjectName,
        toProjectId,
        toProjectName,
        oldStatus,
        newStatus,
      });
    });

    this.events.subscribe<TaskEvent & { oldStatus: string; newStatus: string }>(
      "task.status_changed",
      async (data) => {
        await record(data.taskId, data.type, data.userId, {
          oldStatus: data.oldStatus,
          newStatus: data.newStatus,
        });
      },
    );

    this.events.subscribe<
      TaskEvent & { oldPriority: string; newPriority: string }
    >("task.priority_changed", async (data) => {
      await record(data.taskId, data.type, data.userId, {
        oldPriority: data.oldPriority,
        newPriority: data.newPriority,
      });
    });

    this.events.subscribe<TaskEvent>("task.unassigned", async (data) => {
      await record(data.taskId, data.type, data.userId, {});
    });

    this.events.subscribe<
      TaskEvent & { newAssignee: string; newAssigneeId: string }
    >("task.assignee_changed", async (data) => {
      await record(data.taskId, data.type, data.userId, {
        newAssigneeId: data.newAssigneeId,
        newAssignee: data.newAssignee,
        isSelfAssigned: data.userId === data.newAssigneeId,
      });
    });

    this.events.subscribe<
      TaskEvent & { oldDueDate: Date | null; newDueDate: Date }
    >("task.due_date_changed", async (data) => {
      await record(data.taskId, data.type, data.userId, {
        oldDueDate:
          data.oldDueDate instanceof Date
            ? data.oldDueDate.toISOString()
            : data.oldDueDate,
        newDueDate:
          data.newDueDate instanceof Date
            ? data.newDueDate.toISOString()
            : data.newDueDate,
      });
    });
  }
}
