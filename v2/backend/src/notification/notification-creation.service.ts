import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { safeOutboundError } from "../common/outbound/outbound-request-error";
import { insertReturning } from "../database/dml";
import { NotificationEntity } from "../database/entities/notification.entity";
import { UserNotificationPreferenceEntity } from "../database/entities/user-notification-preference.entity";
import { EventBus } from "../events/event-bus";
import { NotificationDeliveryService } from "../notification-preferences/delivery/notification-delivery.service";
import type { NotificationRow } from "./notification-columns";
import { notificationPreferenceKey } from "./notification-preference-key";
import { canReceiveResourceNotification } from "./resource-access";

export type NewNotification = {
  userId: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  eventData?: Record<string, unknown> | null;
  resourceId?: string;
  resourceType?: string;
};

/**
 * Creates notifications for task, comment and workspace activity, honouring
 * who may see the resource and the recipient's muted categories, then
 * announces and delivers them.
 */
@Injectable()
export class NotificationCreationService {
  private readonly logger = new Logger(NotificationCreationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  /**
   * Stores the notification, or returns null when the recipient may not see
   * the resource or has muted the category. Pass a transaction's manager to
   * write inside it, then `dispatchNotification` after commit.
   */
  async persistNotification(
    {
      userId,
      title,
      content,
      type,
      eventData,
      resourceId,
      resourceType,
    }: NewNotification,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<NotificationRow | null> {
    if (
      !(await canReceiveResourceNotification(
        manager,
        userId,
        resourceId,
        resourceType,
      ))
    ) {
      return null;
    }

    const preferenceKey = notificationPreferenceKey(type);

    if (preferenceKey) {
      const preference = await manager.findOne(
        UserNotificationPreferenceEntity,
        { where: { userId } },
      );

      if (preference?.[preferenceKey] === false) {
        return null;
      }
    }

    const notification = await insertReturning(manager, NotificationEntity, {
      userId,
      title: title ?? null,
      content: content ?? null,
      type: type || "info",
      eventData: eventData ?? null,
      resourceId: resourceId || null,
      resourceType: resourceType || null,
    });

    return notification ?? null;
  }

  async dispatchNotification(notification: NotificationRow): Promise<void> {
    await this.events.publish("notification.created", {
      notificationId: notification.id,
      userId: notification.userId,
    });
    void this.delivery.deliverNotification(notification.id).catch((error) => {
      this.logger.error(
        `Failed to deliver notification ${notification.id}: ${safeOutboundError(error)}`,
      );
    });
  }

  async createNotification(
    data: NewNotification,
  ): Promise<NotificationRow | null> {
    const notification = await this.persistNotification(data);
    if (notification) await this.dispatchNotification(notification);
    return notification;
  }
}
