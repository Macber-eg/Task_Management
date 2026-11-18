import { Injectable, Logger } from "@nestjs/common";
import { safeOutboundError } from "../../../common/outbound/outbound-request-error";
import { ChatTaskReader } from "../shared/chat-task-reader";
import { taskUrl } from "../shared/task-url";
import { postToGenericWebhook } from "./generic-webhook-client";
import type { GenericWebhookConfig } from "./generic-webhook-config";
import { GenericWebhookHealth } from "./generic-webhook-health";

/**
 * Builds the generic webhook envelopes and delivers them. Delivery failures
 * are logged without the destination and recorded as webhook health.
 */
@Injectable()
export class GenericWebhookDelivery {
  private readonly logger = new Logger(GenericWebhookDelivery.name);

  constructor(
    private readonly tasks: ChatTaskReader,
    private readonly health: GenericWebhookHealth,
  ) {}

  /** A task event; skipped when the task left the project. */
  async sendEvent(
    config: GenericWebhookConfig,
    eventName: string,
    taskId: string,
    projectId: string,
    userId: string | null,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    const task = await this.tasks.readTask(taskId, projectId);
    if (!task) return false;

    const actor = await this.actor(userId);

    return this.deliver(config, eventName, taskId, projectId, {
      event: eventName,
      timestamp: new Date().toISOString(),
      integration: {
        type: "generic-webhook",
      },
      project: {
        id: task.projectId,
        name: task.projectName,
        workspaceId: task.workspaceId,
      },
      task: {
        id: task.id,
        number: task.number,
        title: task.title,
        status: task.status,
        statusName: task.columnName ?? task.status,
        priority: task.priority,
        url: taskUrl(task),
      },
      actor,
      data,
    });
  }

  /** The task row is gone: the envelope carries the event's title only. */
  async sendTaskDeleted(
    config: GenericWebhookConfig,
    event: {
      taskId: string;
      projectId: string;
      userId: string | null;
      title: string;
    },
  ): Promise<boolean> {
    const project = await this.tasks.readProject(event.projectId);
    if (!project) return false;

    const actor = await this.actor(event.userId);

    return this.deliver(config, "task.deleted", event.taskId, event.projectId, {
      event: "task.deleted",
      timestamp: new Date().toISOString(),
      integration: {
        type: "generic-webhook",
      },
      project: {
        id: project.id,
        name: project.name,
        workspaceId: project.workspaceId,
      },
      task: {
        id: event.taskId,
        title: event.title,
      },
      actor,
      data: {},
    });
  }

  private async actor(
    userId: string | null,
  ): Promise<{ id: string | null; name: string | null }> {
    if (!userId) {
      return { id: null, name: null };
    }
    const user = await this.tasks.readUser(userId);
    return { id: user?.id ?? userId, name: user?.name ?? null };
  }

  private async deliver(
    config: GenericWebhookConfig,
    eventName: string,
    taskId: string,
    projectId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const attempt = {
      eventName,
      taskId,
      projectId,
      webhookUrl: "configured destination",
    };

    try {
      await postToGenericWebhook(config.webhookUrl, payload, config.secret);

      void this.health.persist(projectId, (currentConfig) => ({
        ...currentConfig,
        health: {
          ...currentConfig.health,
          lastSuccessAt: new Date().toISOString(),
          lastFailureMessage: undefined,
          lastAttempt: attempt,
        },
      }));
      return true;
    } catch (error) {
      const message = safeOutboundError(error);

      void this.health.persist(projectId, (currentConfig) => ({
        ...currentConfig,
        health: {
          ...currentConfig.health,
          lastFailureAt: new Date().toISOString(),
          lastFailureMessage: message,
          failureCount: (currentConfig.health?.failureCount ?? 0) + 1,
          lastAttempt: attempt,
        },
      }));

      this.logger.error("postToGenericWebhook failed", {
        error: message,
        eventName,
        taskId,
        projectId,
        webhookUrl: "configured destination",
      });
      return false;
    }
  }
}
