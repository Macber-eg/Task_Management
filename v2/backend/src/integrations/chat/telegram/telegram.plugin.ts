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
import { postToTelegram } from "./telegram-client";
import {
  normalizeTelegramConfig,
  type TelegramConfig,
  type TelegramEventKey,
  validateTelegramConfig,
} from "./telegram-config";
import {
  buildTelegramText,
  telegramTargetIdentifier,
  telegramTaskUrl,
} from "./telegram-message";

type TaskRef = { taskId: string; projectId: string; userId: string | null };

@Injectable()
export class TelegramPlugin implements IntegrationPlugin, OnModuleInit {
  readonly type = "telegram";
  readonly name = "Telegram";
  private readonly logger = new Logger(TelegramPlugin.name);

  constructor(
    private readonly registry: IntegrationPluginRegistry,
    private readonly tasks: ChatTaskReader,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async validateConfig(config: unknown) {
    return validateTelegramConfig(config);
  }

  onTaskCreated(event: TaskCreatedEvent, context: PluginContext) {
    return this.send(context, "taskCreated", event, {
      title: "New task created",
      body: `A new task was added: ${event.title}`,
    });
  }

  onTaskStatusChanged(event: TaskStatusChangedEvent, context: PluginContext) {
    return this.send(context, "taskStatusChanged", event, {
      title: "Task status changed",
      body: `${event.title} moved from ${toSentenceCase(event.oldStatus)} to ${toSentenceCase(event.newStatus)}.`,
    });
  }

  onTaskPriorityChanged(
    event: TaskPriorityChangedEvent,
    context: PluginContext,
  ) {
    return this.send(context, "taskPriorityChanged", event, {
      title: "Task priority changed",
      body: `${event.title} changed from ${toSentenceCase(event.oldPriority)} to ${toSentenceCase(event.newPriority)}.`,
    });
  }

  onTaskTitleChanged(event: TaskTitleChangedEvent, context: PluginContext) {
    return this.send(context, "taskTitleChanged", event, {
      title: "Task title changed",
      body: `Task renamed from ${truncate(event.oldTitle, 120)} to ${truncate(event.newTitle, 120)}.`,
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
    key: TelegramEventKey,
    event: TaskRef,
    message: { title: string; body: string },
  ): Promise<void> {
    // The config holds the bot token: never log it or the validation issues.
    if (!validateTelegramConfig(context.config).valid) {
      this.logger.error(
        "Invalid Telegram plugin config; skipping event dispatch",
        {
          reason: "Invalid configuration",
          featureKey: key,
          projectId: event.projectId,
          taskId: event.taskId,
        },
      );
      return;
    }

    const config = normalizeTelegramConfig(context.config as TelegramConfig);
    if (!(config.events?.[key] ?? false)) return;

    const [task, user] = await Promise.all([
      this.tasks.readTask(event.taskId, event.projectId),
      event.userId ? this.tasks.readUser(event.userId) : undefined,
    ]);
    if (!task) return;
    const taskUrl = telegramTaskUrl(
      process.env.KANEO_CLIENT_URL,
      task.workspaceId,
      task.projectId,
      event.taskId,
    );

    try {
      await postToTelegram(config.botToken, {
        chat_id: config.chatId,
        text: buildTelegramText(message.title, message.body, {
          taskTitle: task.title,
          taskNumber: task.number,
          projectName: task.projectName,
          taskUrl,
          actorName: user?.name ?? null,
          status: task.status,
          priority: task.priority,
        }),
        parse_mode: "HTML",
        disable_web_page_preview: false,
        message_thread_id: config.threadId,
      });
    } catch (error) {
      this.logger.error("sendTelegramMessage postToTelegram failed", {
        error: safeOutboundError(error),
        telegramTarget: telegramTargetIdentifier(config),
        taskUrl,
      });
    }
  }
}
