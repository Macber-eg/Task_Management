import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { IntegrationPlugin } from "../../core/integration-plugin";
import { IntegrationPluginRegistry } from "../../core/integration-plugin-registry";
import type {
  PluginContext,
  TaskCommentCreatedEvent,
  TaskCreatedEvent,
  TaskDescriptionChangedEvent,
  TaskPriorityChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
} from "../../core/task-events";
import { ChatTaskReader } from "../shared/chat-task-reader";
import {
  commentBody,
  descriptionChangedBody,
  toSentenceCase,
  truncate,
} from "../shared/message-text";
import { taskUrl } from "../shared/task-url";
import { postToMattermost } from "./mattermost-client";
import {
  normalizeMattermostConfig,
  type MattermostConfig,
  type MattermostEventKey,
  validateMattermostConfig,
} from "./mattermost-config";
import { buildMattermostMessage } from "./mattermost-message";

type TaskRef = { taskId: string; projectId: string; userId: string | null };

@Injectable()
export class MattermostPlugin implements IntegrationPlugin, OnModuleInit {
  readonly type = "mattermost";
  readonly name = "Mattermost";

  constructor(
    private readonly registry: IntegrationPluginRegistry,
    private readonly tasks: ChatTaskReader,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  validateConfig(config: unknown) {
    return validateMattermostConfig(config);
  }

  onTaskCreated(event: TaskCreatedEvent, context: PluginContext) {
    return this.send(
      context,
      "taskCreated",
      event,
      "New task created",
      `A new task was added: ${event.title}`,
    );
  }

  onTaskStatusChanged(event: TaskStatusChangedEvent, context: PluginContext) {
    return this.send(
      context,
      "taskStatusChanged",
      event,
      "Task status changed",
      `${event.title} moved from ${toSentenceCase(event.oldStatus)} to ${toSentenceCase(event.newStatus)}.`,
    );
  }

  onTaskPriorityChanged(
    event: TaskPriorityChangedEvent,
    context: PluginContext,
  ) {
    return this.send(
      context,
      "taskPriorityChanged",
      event,
      "Task priority changed",
      `${event.title} changed from ${toSentenceCase(event.oldPriority)} to ${toSentenceCase(event.newPriority)}.`,
    );
  }

  onTaskTitleChanged(event: TaskTitleChangedEvent, context: PluginContext) {
    return this.send(
      context,
      "taskTitleChanged",
      event,
      "Task title changed",
      `Task renamed from ${truncate(event.oldTitle, 120)} to ${truncate(event.newTitle, 120)}.`,
    );
  }

  onTaskDescriptionChanged(
    event: TaskDescriptionChangedEvent,
    context: PluginContext,
  ) {
    return this.send(
      context,
      "taskDescriptionChanged",
      event,
      "Task description changed",
      descriptionChangedBody(event.newDescription),
    );
  }

  onTaskCommentCreated(event: TaskCommentCreatedEvent, context: PluginContext) {
    return this.send(
      context,
      "taskCommentCreated",
      event,
      "New task comment",
      commentBody(event.comment),
    );
  }

  private async send(
    context: PluginContext,
    key: MattermostEventKey,
    event: TaskRef,
    title: string,
    body: string,
  ): Promise<void> {
    const config = normalizeMattermostConfig(context.config as MattermostConfig);
    if (!(config.events?.[key] ?? false)) return;

    const task = await this.tasks.readTask(event.taskId, event.projectId);
    if (!task) return;
    const user = event.userId
      ? await this.tasks.readUser(event.userId)
      : undefined;

    await postToMattermost(
      config.webhookUrl,
      buildMattermostMessage(title, body, {
        taskTitle: task.title,
        taskNumber: task.number,
        projectName: task.projectName,
        taskUrl: taskUrl(task),
        actorName: user?.name ?? null,
        status: task.status,
        priority: task.priority,
      }),
    );
  }
}
