import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { safeOutboundError } from "../../common/outbound/outbound-request-error";
import { NotificationEntity } from "../../database/entities/notification.entity";
import { UserNotificationPreferenceEntity } from "../../database/entities/user-notification-preference.entity";
import { UserNotificationWorkspaceRuleEntity } from "../../database/entities/user-notification-workspace-rule.entity";
import { canReceiveResourceNotification } from "../../notification/resource-access";
import { decryptPreference } from "../decrypted-preference";
import { getClientUrl } from "./client-url";
import { buildDeliveryContent } from "./delivery-content";
import { NotificationMailer } from "./notification-mailer";
import {
  sendGotifyNotification,
  sendNtfyNotification,
  sendWebhookNotification,
} from "./push-channels";
import { resolveEmailTask } from "./resolve-email-task";
import { resolveNotificationContext } from "./resolve-notification-context";

/**
 * Sends a stored notification through the channels the recipient enabled
 * both globally and in the workspace's rule. Channel failures are logged
 * without URLs, tokens or response bodies and never affect each other.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailer: NotificationMailer,
  ) {}

  async deliverNotification(notificationId: string): Promise<void> {
    const manager = this.dataSource.manager;
    const notification = await manager.findOne(NotificationEntity, {
      where: { id: notificationId },
    });

    if (
      !notification ||
      !(await canReceiveResourceNotification(
        manager,
        notification.userId,
        notification.resourceId,
        notification.resourceType,
      ))
    ) {
      return;
    }

    const context = await resolveNotificationContext(manager, notification);
    if (!context) {
      this.logger.log(
        `Notification delivery skipped: unresolved context (notification ${notificationId}, resource ${notification.resourceType}:${notification.resourceId}; missing resource, deleted task, or unsupported resource type)`,
      );
      return;
    }

    const [user] = (await manager.query(
      `SELECT email, name, locale FROM "user" WHERE id = $1 LIMIT 1`,
      [notification.userId],
    )) as { email: string; name: string; locale: string | null }[];

    if (!user) {
      return;
    }

    const preference = await manager.findOne(
      UserNotificationPreferenceEntity,
      { where: { userId: notification.userId } },
    );

    if (!preference) {
      return;
    }

    const decryptedPreference = decryptPreference(preference);

    const rule = await manager.findOne(UserNotificationWorkspaceRuleEntity, {
      where: { userId: notification.userId, workspaceId: context.workspaceId },
      relations: { selectedProjects: true },
    });

    if (!rule?.isActive) {
      return;
    }

    if (
      rule.projectMode === "selected" &&
      (!context.projectId ||
        !(rule.selectedProjects ?? []).some(
          (project) => project.projectId === context.projectId,
        ))
    ) {
      return;
    }

    const content = buildDeliveryContent({
      type: notification.type,
      title: notification.title ?? null,
      content: notification.content ?? null,
      eventData:
        notification.eventData && typeof notification.eventData === "object"
          ? (notification.eventData as Record<string, unknown>)
          : null,
    });

    const webhookPayload = {
      notification: {
        id: notification.id,
        type: notification.type,
        title: content.title,
        content: content.body,
        createdAt: notification.createdAt,
        eventData: notification.eventData,
        resourceId: notification.resourceId,
        resourceType: notification.resourceType,
      },
      workspace: {
        id: context.workspaceId,
        name: context.workspaceName,
      },
      project: context.projectId
        ? {
            id: context.projectId,
            name: context.projectName,
          }
        : null,
      task: context.taskId
        ? {
            id: context.taskId,
            title: context.taskTitle,
            url: context.taskUrl,
          }
        : null,
      user: {
        id: notification.userId,
        email: user.email,
        name: user.name,
      },
    };

    const deliveries: Array<Promise<void>> = [];

    if (decryptedPreference.emailEnabled && rule.emailEnabled && user.email) {
      const recipient = user.email;
      deliveries.push(
        (async () => {
          const task = context.taskId
            ? await resolveEmailTask(manager, context.taskId)
            : undefined;
          await this.mailer.sendNotificationEmail(recipient, content.title, {
            title: content.title,
            message: content.body,
            actionUrl: context.taskUrl,
            locale: user.locale ?? null,
            breadcrumb: context.projectName
              ? `${context.workspaceName} / ${context.projectName}`
              : context.workspaceName,
            task,
            settingsUrl: `${getClientUrl()}/dashboard/settings/account/notifications`,
          });
        })(),
      );
    }

    if (
      decryptedPreference.ntfyEnabled &&
      decryptedPreference.ntfyServerUrl &&
      decryptedPreference.ntfyTopic &&
      rule.ntfyEnabled
    ) {
      deliveries.push(
        sendNtfyNotification({
          serverUrl: decryptedPreference.ntfyServerUrl,
          topic: decryptedPreference.ntfyTopic,
          token: decryptedPreference.ntfyToken,
          title: content.title,
          body: content.body,
          clickUrl: context.taskUrl,
        }),
      );
    }

    if (
      decryptedPreference.gotifyEnabled &&
      decryptedPreference.gotifyServerUrl &&
      decryptedPreference.gotifyToken &&
      rule.gotifyEnabled
    ) {
      deliveries.push(
        sendGotifyNotification({
          serverUrl: decryptedPreference.gotifyServerUrl,
          token: decryptedPreference.gotifyToken,
          title: content.title,
          body: content.body,
          clickUrl: context.taskUrl,
        }),
      );
    }

    if (
      decryptedPreference.webhookEnabled &&
      decryptedPreference.webhookUrl &&
      rule.webhookEnabled
    ) {
      deliveries.push(
        sendWebhookNotification({
          webhookUrl: decryptedPreference.webhookUrl,
          secret: decryptedPreference.webhookSecret,
          payload: webhookPayload,
        }),
      );
    }

    const results = await Promise.allSettled(deliveries);
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.error(
          `Notification delivery failed (notification ${notificationId}): ${safeOutboundError(result.reason)}`,
        );
      }
    }
  }
}
