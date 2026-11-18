import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  activityListSchema,
  activitySchema,
  workspaceActivityListSchema,
} from "./response";
import {
  activitiesQuery,
  createActivityBody,
  createCommentBody,
  deleteCommentBody,
  taskIdParam,
  updateCommentBody,
  workspaceIdParam,
} from "./schema";

export const getWorkspaceActivitiesRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceActivities",
  path: "/workspace/{workspaceId}",
  tags: ["Activity"],
  summary: "Get recent workspace activity",
  description:
    "Get the 20 most recent task events across a workspace's active projects from the last 30 days, newest first. Each event carries a short plain-text excerpt instead of its full content.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "Recent activity in the workspace",
      workspaceActivityListSchema,
    ),
    403: errorResponse("Missing project:read or task:read permission"),
    404: errorResponse("Workspace not found"),
  },
});

export const getActivitiesRoute = createRoute({
  method: "get",
  operationId: "getActivities",
  path: "/{taskId}",
  tags: ["Activity"],
  summary: "Get task activity",
  description:
    "Get a task's activity feed, newest first: comments alongside system events such as status and assignee changes. Set limit to request a bounded preview; omit it for the full feed.",
  request: { params: taskIdParam, query: activitiesQuery },
  responses: {
    200: jsonResponse("List of activities for the task", activityListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
  },
});

export const createActivityRoute = createRoute({
  method: "post",
  operationId: "createActivity",
  path: "/create",
  tags: ["Activity"],
  summary: "Create activity",
  description:
    "Record a system-generated event on a task. Most events are written by the server itself; this exists for importers and integrations.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createActivityBody } },
    },
  },
  responses: {
    200: jsonResponse("The created activity", activitySchema),
    400: errorResponse(
      "Invalid body, or comment activity submitted through the generic endpoint",
    ),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const createCommentRoute = createRoute({
  method: "post",
  operationId: "createComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Create comment",
  description:
    "Add a comment to a task. Equivalent to POST /comment/{taskId}, kept for the activity-feed client.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The created comment", activitySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateCommentRoute = createRoute({
  method: "put",
  operationId: "updateComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Update comment",
  description: "Edit a comment. Only the comment's author may do this.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updateCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated comment", activitySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Not the author, or no access to the project"),
    404: errorResponse("Activity or comment not found"),
  },
});

export const deleteCommentRoute = createRoute({
  method: "delete",
  operationId: "deleteComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Delete comment",
  description: "Delete a comment. Only the comment's author may do this.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: deleteCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The deleted comment", activitySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Not the author, or no access to the project"),
    404: errorResponse("Activity or comment not found"),
  },
});
