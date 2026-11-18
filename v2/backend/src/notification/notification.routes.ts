import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  bulkResultSchema,
  notificationListSchema,
  notificationSchema,
} from "./response";
import {
  createNotificationBody,
  notificationParam,
  notificationWorkspaceQuery,
} from "./schema";

export const listNotificationsRoute = createRoute({
  method: "get",
  operationId: "listNotifications",
  path: "/",
  tags: ["Notifications"],
  summary: "List notifications",
  request: { query: notificationWorkspaceQuery },
  description:
    "Get up to 50 notifications for the current user, read and unread. Optionally limit them to one workspace before applying the limit.",
  responses: {
    200: jsonResponse("List of notifications", notificationListSchema),
  },
});

export const createNotificationRoute = createRoute({
  method: "post",
  operationId: "createNotification",
  path: "/",
  tags: ["Notifications"],
  summary: "Create notification",
  description:
    "Create a notification for the current user. Most notifications are raised by the server from task and workspace events; this exists for integrations. Returns null when the user has turned off this notification category in their preferences.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createNotificationBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The created notification, or null when the user has muted this notification type",
      notificationSchema.nullable(),
    ),
    400: errorResponse("Invalid request"),
  },
});

export const markAsReadRoute = createRoute({
  method: "patch",
  operationId: "markNotificationAsRead",
  path: "/{id}/read",
  tags: ["Notifications"],
  summary: "Mark notification read",
  description:
    "Mark one notification as read. Scoped to the current user, so another user's notification is not found.",
  request: { params: notificationParam },
  responses: {
    200: jsonResponse("The updated notification", notificationSchema),
    404: errorResponse("Notification not found"),
  },
});

export const markAllAsReadRoute = createRoute({
  method: "patch",
  operationId: "markAllNotificationsAsRead",
  path: "/read-all",
  tags: ["Notifications"],
  summary: "Mark all read",
  request: { query: notificationWorkspaceQuery },
  description:
    "Mark notifications for the current user as read, optionally limited to one workspace.",
  responses: {
    200: jsonResponse("All notifications marked as read", bulkResultSchema),
  },
});

export const clearAllRoute = createRoute({
  method: "delete",
  operationId: "clearAllNotifications",
  path: "/clear-all",
  tags: ["Notifications"],
  summary: "Clear all",
  request: { query: notificationWorkspaceQuery },
  description:
    "Permanently delete notifications for the current user, optionally limited to one workspace. This cannot be undone.",
  responses: {
    200: jsonResponse("All notifications cleared", bulkResultSchema),
  },
});
