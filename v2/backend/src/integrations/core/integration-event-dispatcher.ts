import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { IntegrationEntity } from "../../database/entities/integration.entity";
import { EventBus } from "../../events/event-bus";
import type { IntegrationPlugin } from "./integration-plugin";
import { IntegrationPluginRegistry } from "./integration-plugin-registry";
import { createPluginContext } from "./plugin-context";
import type {
  TaskAssigneeChangedEvent,
  TaskCommentCreatedEvent,
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskDescriptionChangedEvent,
  TaskDueDateChangedEvent,
  TaskEvent,
  TaskMovedEvent,
  TaskPriorityChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
  TaskUnassignedEvent,
} from "./task-events";

type Hook = {
  [K in keyof IntegrationPlugin]-?: K extends `onTask${string}` ? K : never;
}[keyof IntegrationPlugin];

/**
 * Forwards task and comment events to the plugin of every active integration
 * in the task's project. Each plugin failure is logged and isolated.
 */
@Injectable()
export class IntegrationEventDispatcher implements OnModuleInit {
  private readonly logger = new Logger(IntegrationEventDispatcher.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly registry: IntegrationPluginRegistry,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<TaskCreatedEvent>("task.created", (data) =>
      this.broadcast("onTaskCreated", "task.created", {
        taskId: data.taskId,
        projectId: data.projectId,
        userId: data.userId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: data.status,
        number: data.number,
      }),
    );
    this.events.subscribe<TaskStatusChangedEvent>(
      "task.status_changed",
      (data) =>
        this.broadcast(
          "onTaskStatusChanged",
          "task.status_changed",
          {
            sourceIntegrationId: data.sourceIntegrationId,
            taskId: data.taskId,
            projectId: data.projectId,
            userId: data.userId,
            oldStatus: data.oldStatus,
            newStatus: data.newStatus,
            title: data.title,
          },
          data.sourceIntegrationId,
        ),
    );
    this.events.subscribe<TaskPriorityChangedEvent>(
      "task.priority_changed",
      (data) =>
        this.broadcast("onTaskPriorityChanged", "task.priority_changed", {
          taskId: data.taskId,
          projectId: data.projectId,
          userId: data.userId,
          oldPriority: data.oldPriority,
          newPriority: data.newPriority,
          title: data.title,
        }),
    );
    this.events.subscribe<TaskTitleChangedEvent>("task.title_changed", (data) =>
      this.broadcast(
        "onTaskTitleChanged",
        "task.title_changed",
        {
          sourceIntegrationId: data.sourceIntegrationId,
          taskId: data.taskId,
          projectId: data.projectId,
          userId: data.userId,
          oldTitle: data.oldTitle,
          newTitle: data.newTitle,
        },
        data.sourceIntegrationId,
      ),
    );
    this.events.subscribe<TaskDescriptionChangedEvent>(
      "task.description_changed",
      (data) =>
        this.broadcast(
          "onTaskDescriptionChanged",
          "task.description_changed",
          {
            sourceIntegrationId: data.sourceIntegrationId,
            taskId: data.taskId,
            projectId: data.projectId,
            userId: data.userId,
            oldDescription: data.oldDescription,
            newDescription: data.newDescription,
          },
          data.sourceIntegrationId,
        ),
    );
    this.events.subscribe<TaskCommentCreatedEvent>("comment.created", (data) =>
      this.broadcast("onTaskCommentCreated", "comment.created", {
        taskId: data.taskId,
        projectId: data.projectId,
        userId: data.userId,
        comment: data.comment,
      }),
    );
    this.events.subscribe<TaskDeletedEvent>("task.deleted", (data) =>
      this.broadcast("onTaskDeleted", "task.deleted", {
        taskId: data.taskId,
        projectId: data.projectId,
        userId: data.userId,
        title: data.title,
      }),
    );
    this.events.subscribe<Omit<TaskMovedEvent, "projectId">>(
      "task.moved",
      (data) =>
        this.broadcast("onTaskMoved", "task.moved", {
          taskId: data.taskId,
          projectId: data.toProjectId,
          userId: data.userId,
          fromProjectId: data.fromProjectId,
          fromProjectName: data.fromProjectName,
          toProjectId: data.toProjectId,
          toProjectName: data.toProjectName,
          oldStatus: data.oldStatus,
          newStatus: data.newStatus,
        }),
    );
    this.events.subscribe<TaskDueDateChangedEvent>(
      "task.due_date_changed",
      (data) =>
        this.broadcast("onTaskDueDateChanged", "task.due_date_changed", {
          taskId: data.taskId,
          projectId: data.projectId,
          userId: data.userId,
          title: data.title,
          oldDueDate: data.oldDueDate,
          newDueDate: data.newDueDate,
        }),
    );
    this.events.subscribe<TaskAssigneeChangedEvent>(
      "task.assignee_changed",
      (data) =>
        this.broadcast("onTaskAssigneeChanged", "task.assignee_changed", {
          taskId: data.taskId,
          projectId: data.projectId,
          userId: data.userId,
          title: data.title,
          oldAssignee: data.oldAssignee,
          newAssignee: data.newAssignee,
          newAssigneeId: data.newAssigneeId,
        }),
    );
    this.events.subscribe<TaskUnassignedEvent>("task.unassigned", (data) =>
      this.broadcast("onTaskUnassigned", "task.unassigned", {
        taskId: data.taskId,
        projectId: data.projectId,
        userId: data.userId,
        title: data.title,
      }),
    );
  }

  /**
   * Runs `hook` for each active integration of the project, skipping the one
   * the change came from.
   */
  async broadcast(
    hook: Hook,
    eventName: string,
    event: TaskEvent,
    sourceIntegrationId?: string,
  ): Promise<void> {
    const integrations = await this.dataSource.manager.find(
      IntegrationEntity,
      { where: { projectId: event.projectId, isActive: true } },
    );

    for (const integration of integrations) {
      if (sourceIntegrationId && integration.id === sourceIntegrationId)
        continue;
      const plugin = this.registry.get(integration.type);
      const handler = plugin?.[hook] as
        | ((event: TaskEvent, context: unknown) => Promise<void>)
        | undefined;
      if (!plugin || !handler) continue;

      const context = createPluginContext(integration);

      try {
        await handler.call(plugin, event, context);
      } catch (error) {
        this.logger.error(
          `Plugin ${plugin.type} error on ${eventName}:`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
