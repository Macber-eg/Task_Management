import { activitySchema } from "../activity/response";
import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import { commentListSchema } from "./response";
import {
  commentParam,
  createCommentBody,
  taskIdParam,
  updateCommentBody,
} from "./schema";

export const getTaskCommentsRoute = createRoute({
  method: "get",
  operationId: "getTaskComments",
  path: "/{taskId}",
  tags: ["Comments"],
  summary: "Get task comments",
  description:
    "Get every comment on a task, oldest first, each with its author's name and avatar.",
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of comments for the task", commentListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
  },
});

export const createTaskCommentRoute = createRoute({
  method: "post",
  operationId: "createTaskComment",
  path: "/{taskId}",
  tags: ["Comments"],
  summary: "Create task comment",
  description:
    "Add a comment to a task. Mentions in the content notify the mentioned users, and the assignee is notified too. Returns the stored activity row, which carries no author object -- read the list route for that.",
  request: {
    params: taskIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The created comment", activitySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, missing task:update permission, or external attribution without workspace:manage_settings",
    ),
    404: errorResponse("Task not found"),
  },
});

export const updateTaskCommentRoute = createRoute({
  method: "put",
  operationId: "updateTaskComment",
  path: "/{id}",
  tags: ["Comments"],
  summary: "Update task comment",
  description: "Edit a comment. Only the comment's author may do this.",
  request: {
    params: commentParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated comment", activitySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Not the author, or missing task:update permission"),
    404: errorResponse("Comment not found"),
  },
});

export const deleteTaskCommentRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskComment",
  path: "/{id}",
  tags: ["Comments"],
  summary: "Delete task comment",
  description: "Delete a comment. Only the comment's author may do this.",
  request: { params: commentParam },
  responses: {
    200: jsonResponse("The deleted comment", activitySchema),
    403: errorResponse("Not the author, or missing task:update permission"),
    404: errorResponse("Comment not found"),
  },
});
