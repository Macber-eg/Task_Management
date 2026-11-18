import { Controller } from "@nestjs/common";
import { UserId } from "../auth/current-user.decorator";
import { reply } from "../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  clearAllRoute,
  createNotificationRoute,
  listNotificationsRoute,
  markAllAsReadRoute,
  markAsReadRoute,
} from "./notification.routes";
import { NotificationCreationService } from "./notification-creation.service";
import { NotificationInboxService } from "./notification-inbox.service";
import { NotificationQueryService } from "./notification-query.service";

@Controller("notification")
export class NotificationController {
  constructor(
    private readonly query: NotificationQueryService,
    private readonly creation: NotificationCreationService,
    private readonly inbox: NotificationInboxService,
  ) {}

  @ApiRoute(listNotificationsRoute)
  listNotifications(
    @Input() input: RouteInput<typeof listNotificationsRoute>,
    @UserId() userId: string,
  ) {
    return this.query.getNotifications(userId, input.query.workspaceId);
  }

  @ApiRoute(createNotificationRoute)
  async createNotification(
    @Input() input: RouteInput<typeof createNotificationRoute>,
    @UserId() userId: string,
  ) {
    const {
      title,
      message,
      type,
      eventData,
      relatedEntityId,
      relatedEntityType,
    } = input.json;
    const notification = await this.creation.createNotification({
      userId,
      title,
      content: message,
      type,
      eventData,
      resourceId: relatedEntityId,
      resourceType: relatedEntityType,
    });
    // A muted category answers with a JSON `null`, not an empty body.
    return notification ?? reply(200, null);
  }

  @ApiRoute(markAsReadRoute)
  markAsRead(
    @Input() input: RouteInput<typeof markAsReadRoute>,
    @UserId() userId: string,
  ) {
    return this.inbox.markNotificationAsRead(input.param.id, userId);
  }

  @ApiRoute(markAllAsReadRoute)
  markAllAsRead(
    @Input() input: RouteInput<typeof markAllAsReadRoute>,
    @UserId() userId: string,
  ) {
    return this.inbox.markAllNotificationsAsRead(
      userId,
      input.query.workspaceId,
    );
  }

  @ApiRoute(clearAllRoute)
  clearAll(
    @Input() input: RouteInput<typeof clearAllRoute>,
    @UserId() userId: string,
  ) {
    return this.inbox.clearNotifications(userId, input.query.workspaceId);
  }
}
