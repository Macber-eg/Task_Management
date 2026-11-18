import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { IntegrationPlugin } from "../../core/integration-plugin";
import { IntegrationPluginRegistry } from "../../core/integration-plugin-registry";
import type {
  PluginContext,
  TaskAssigneeChangedEvent,
  TaskCommentCreatedEvent,
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskDescriptionChangedEvent,
  TaskDueDateChangedEvent,
  TaskMovedEvent,
  TaskPriorityChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
  TaskUnassignedEvent,
} from "../../core/task-events";
import {
  type GenericWebhookConfig,
  type GenericWebhookEventKey,
  normalizeGenericWebhookConfig,
  validateGenericWebhookConfig,
} from "./generic-webhook-config";
import { GenericWebhookDelivery } from "./generic-webhook-delivery";

type TaskRef = { taskId: string; projectId: string; userId: string | null };

@Injectable()
export class GenericWebhookPlugin implements IntegrationPlugin, OnModuleInit {
  readonly type = "generic-webhook";
  readonly name = "Generic Webhook";

  constructor(
    private readonly registry: IntegrationPluginRegistry,
    private readonly delivery: GenericWebhookDelivery,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  validateConfig(config: unknown) {
    return validateGenericWebhookConfig(config);
  }

  async onTaskCreated(event: TaskCreatedEvent, context: PluginContext) {
    await this.send(context, "taskCreated", "task.created", event, {
      title: event.title,
      description: event.description,
      priority: event.priority,
      status: event.status,
      number: event.number,
    });
  }

  async onTaskStatusChanged(
    event: TaskStatusChangedEvent,
    context: PluginContext,
  ) {
    await this.send(context, "taskStatusChanged", "task.status_changed", event, {
      title: event.title,
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
    });
  }

  async onTaskPriorityChanged(
    event: TaskPriorityChangedEvent,
    context: PluginContext,
  ) {
    await this.send(
      context,
      "taskPriorityChanged",
      "task.priority_changed",
      event,
      {
        title: event.title,
        oldPriority: event.oldPriority,
        newPriority: event.newPriority,
      },
    );
  }

  async onTaskTitleChanged(
    event: TaskTitleChangedEvent,
    context: PluginContext,
  ) {
    await this.send(context, "taskTitleChanged", "task.title_changed", event, {
      oldTitle: event.oldTitle,
      newTitle: event.newTitle,
    });
  }

  async onTaskDescriptionChanged(
    event: TaskDescriptionChangedEvent,
    context: PluginContext,
  ) {
    await this.send(
      context,
      "taskDescriptionChanged",
      "task.description_changed",
      event,
      {
        oldDescription: event.oldDescription,
        newDescription: event.newDescription,
      },
    );
  }

  async onTaskCommentCreated(
    event: TaskCommentCreatedEvent,
    context: PluginContext,
  ) {
    await this.send(
      context,
      "taskCommentCreated",
      "task.comment_created",
      event,
      { comment: event.comment },
    );
  }

  async onTaskDeleted(event: TaskDeletedEvent, context: PluginContext) {
    const config = this.enabledConfig(context, "taskDeleted");
    if (!config) return;
    await this.delivery.sendTaskDeleted(config, event);
  }

  async onTaskMoved(event: TaskMovedEvent, context: PluginContext) {
    await this.send(context, "taskMoved", "task.moved", event, {
      fromProjectId: event.fromProjectId,
      fromProjectName: event.fromProjectName,
      toProjectId: event.toProjectId,
      toProjectName: event.toProjectName,
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
    });
  }

  async onTaskDueDateChanged(
    event: TaskDueDateChangedEvent,
    context: PluginContext,
  ) {
    await this.send(
      context,
      "taskDueDateChanged",
      "task.due_date_changed",
      event,
      {
        title: event.title,
        oldDueDate: event.oldDueDate,
        newDueDate: event.newDueDate,
      },
    );
  }

  async onTaskAssigneeChanged(
    event: TaskAssigneeChangedEvent,
    context: PluginContext,
  ) {
    await this.send(
      context,
      "taskAssigneeChanged",
      "task.assignee_changed",
      event,
      {
        title: event.title,
        oldAssigneeId: event.oldAssignee ?? null,
        newAssigneeId: event.newAssigneeId,
        newAssignee: event.newAssignee ?? null,
      },
    );
  }

  async onTaskUnassigned(event: TaskUnassignedEvent, context: PluginContext) {
    await this.send(context, "taskUnassigned", "task.unassigned", event, {
      title: event.title,
    });
  }

  private enabledConfig(context: PluginContext, key: GenericWebhookEventKey) {
    const config = normalizeGenericWebhookConfig(
      context.config as GenericWebhookConfig,
    );
    return (config.events?.[key] ?? false) ? config : undefined;
  }

  private async send(
    context: PluginContext,
    key: GenericWebhookEventKey,
    eventName: string,
    event: TaskRef,
    data: Record<string, unknown>,
  ) {
    const config = this.enabledConfig(context, key);
    if (!config) return;
    await this.delivery.sendEvent(
      config,
      eventName,
      event.taskId,
      event.projectId,
      event.userId,
      data,
    );
  }
}
