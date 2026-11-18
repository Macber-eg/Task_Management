import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { safeOutboundError } from "../../../common/outbound/outbound-request-error";
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
import { postToDiscord } from "./discord-client";
import {
  type DiscordConfig,
  type DiscordEventKey,
  normalizeDiscordConfig,
  validateDiscordConfig,
} from "./discord-config";
import { buildDiscordMessage } from "./discord-message";
import { redactDiscordWebhookUrl } from "./redact-discord-webhook-url";

type TaskRef = { taskId: string; projectId: string; userId: string | null };

@Injectable()
export class DiscordPlugin implements IntegrationPlugin, OnModuleInit {
  readonly type = "discord";
  readonly name = "Discord";
  private readonly logger = new Logger(DiscordPlugin.name);

  constructor(
    private readonly registry: IntegrationPluginRegistry,
    private readonly tasks: ChatTaskReader,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  validateConfig(config: unknown) {
    return validateDiscordConfig(config);
  }

  onTaskCreated(event: TaskCreatedEvent, context: PluginContext) {
    return this.send(context, "taskCreated", event, {
      title: "New task created",
      body: `A new task was added: **${event.title}**`,
    });
  }

  onTaskStatusChanged(event: TaskStatusChangedEvent, context: PluginContext) {
    return this.send(context, "taskStatusChanged", event, {
      title: "Task status changed",
      body: `**${event.title}** moved from **${toSentenceCase(event.oldStatus)}** to **${toSentenceCase(event.newStatus)}**.`,
    });
  }

  onTaskPriorityChanged(
    event: TaskPriorityChangedEvent,
    context: PluginContext,
  ) {
    return this.send(context, "taskPriorityChanged", event, {
      title: "Task priority changed",
      body: `**${event.title}** changed from **${toSentenceCase(event.oldPriority)}** to **${toSentenceCase(event.newPriority)}**.`,
    });
  }

  onTaskTitleChanged(event: TaskTitleChangedEvent, context: PluginContext) {
    return this.send(context, "taskTitleChanged", event, {
      title: "Task title changed",
      body: `Task renamed from **${truncate(event.oldTitle, 120)}** to **${truncate(event.newTitle, 120)}**.`,
    });
  }

  onTaskDescriptionChanged(
    event: TaskDescriptionChangedEvent,
    context: PluginContext,
  ) {
    return this.send(context, "taskDescriptionChanged", event, {
      title: "Task description changed",
      body: descriptionChangedBody(event.newDescription),
    });
  }

  onTaskCommentCreated(event: TaskCommentCreatedEvent, context: PluginContext) {
    return this.send(context, "taskCommentCreated", event, {
      title: "New task comment",
      body: commentBody(event.comment),
    });
  }

  private async send(
    context: PluginContext,
    key: DiscordEventKey,
    event: TaskRef,
    message: { title: string; body: string },
  ): Promise<void> {
    const config = normalizeDiscordConfig(context.config as DiscordConfig);
    if (!(config.events?.[key] ?? false)) return;

    const [task, user] = await Promise.all([
      this.tasks.readTask(event.taskId, event.projectId),
      event.userId ? this.tasks.readUser(event.userId) : undefined,
    ]);
    if (!task) return;
    const url = taskUrl(task);

    try {
      await postToDiscord(
        config.webhookUrl,
        buildDiscordMessage(message.title, message.body, {
          taskTitle: task.title,
          taskNumber: task.number,
          projectName: task.projectName,
          taskUrl: url,
          actorName: user?.name ?? null,
          statusSlug: task.status,
          columnName: task.columnName,
          priority: task.priority,
        }),
      );
    } catch (error) {
      this.logger.error("sendDiscordMessage postToDiscord failed", {
        error: safeOutboundError(error),
        webhookUrl: redactDiscordWebhookUrl(config.webhookUrl),
        channelName: config.channelName ?? null,
        taskUrl: url,
      });
    }
  }
}
