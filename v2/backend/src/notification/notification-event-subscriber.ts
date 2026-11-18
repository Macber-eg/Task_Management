import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { EventBus } from "../events/event-bus";
import {
  findProjectWorkspaceId,
  findTaskLocation,
} from "./find-task-location";
import { NotificationCreationService } from "./notification-creation.service";

type TaskCreated = {
  taskId: string;
  userId: string;
  currentUserId?: string;
  title: string;
  projectId: string;
};

type WorkspaceCreated = {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  ownerId?: string;
};

type TaskStatusChanged = {
  taskId: string;
  userId: string;
  oldStatus: string;
  newStatus: string;
  title: string;
  assigneeId?: string;
};

type TaskAssigneeChanged = {
  taskId: string;
  userId: string;
  oldAssignee: string | null;
  newAssignee: string;
  newAssigneeId: string;
  title: string;
};

type TimeEntryCreated = {
  timeEntryId: string;
  taskId: string;
  userId: string;
  taskOwnerId?: string;
  taskTitle?: string;
};

/** Turns task, workspace and time tracking events into notifications. */
@Injectable()
export class NotificationEventSubscriber implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly notifications: NotificationCreationService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<TaskCreated>("task.created", (data) =>
      this.onTaskCreated(data),
    );
    this.events.subscribe<WorkspaceCreated>("workspace.created", (data) =>
      this.onWorkspaceCreated(data),
    );
    this.events.subscribe<TaskStatusChanged>("task.status_changed", (data) =>
      this.onTaskStatusChanged(data),
    );
    this.events.subscribe<TaskAssigneeChanged>(
      "task.assignee_changed",
      (data) => this.onTaskAssigneeChanged(data),
    );
    this.events.subscribe<TimeEntryCreated>("time-entry.created", (data) =>
      this.onTimeEntryCreated(data),
    );
  }

  private async onTaskCreated(data: TaskCreated) {
    if (!data.userId || data.userId === data.currentUserId) return;
    const workspaceId = await findProjectWorkspaceId(
      this.dataSource.manager,
      data.projectId,
    );

    await this.notifications.createNotification({
      userId: data.userId,
      type: "task_created",
      eventData: {
        taskTitle: data.title,
        projectId: data.projectId,
        workspaceId: workspaceId ?? null,
      },
      resourceId: data.taskId,
      resourceType: "task",
    });
  }

  private async onWorkspaceCreated(data: WorkspaceCreated) {
    if (!data.ownerId) return;
    await this.notifications.createNotification({
      userId: data.ownerId,
      type: "workspace_created",
      eventData: {
        workspaceName: data.workspaceName,
      },
      resourceId: data.workspaceId,
      resourceType: "workspace",
    });
  }

  private async onTaskStatusChanged(data: TaskStatusChanged) {
    if (!data.assigneeId || data.assigneeId === data.userId) return;
    const location = await findTaskLocation(
      this.dataSource.manager,
      data.taskId,
    );

    await this.notifications.createNotification({
      userId: data.assigneeId,
      type: "task_status_changed",
      eventData: {
        taskTitle: data.title,
        oldStatus: data.oldStatus,
        newStatus: data.newStatus,
        projectId: location?.projectId ?? null,
        workspaceId: location?.workspaceId ?? null,
      },
      resourceId: data.taskId,
      resourceType: "task",
    });
  }

  private async onTaskAssigneeChanged(data: TaskAssigneeChanged) {
    if (!data.newAssigneeId) return;
    const location = await findTaskLocation(
      this.dataSource.manager,
      data.taskId,
    );

    await this.notifications.createNotification({
      userId: data.newAssigneeId,
      type: "task_assignee_changed",
      eventData: {
        taskTitle: data.title,
        projectId: location?.projectId ?? null,
        workspaceId: location?.workspaceId ?? null,
      },
      resourceId: data.taskId,
      resourceType: "task",
    });
  }

  private async onTimeEntryCreated(data: TimeEntryCreated) {
    if (!data.taskOwnerId || data.taskOwnerId === data.userId) return;
    const location = await findTaskLocation(
      this.dataSource.manager,
      data.taskId,
    );

    await this.notifications.createNotification({
      userId: data.taskOwnerId,
      type: "time_entry_created",
      eventData: {
        taskTitle: data.taskTitle ?? null,
        projectId: location?.projectId ?? null,
        workspaceId: location?.workspaceId ?? null,
      },
      resourceId: data.taskId,
      resourceType: "task",
    });
  }
}
