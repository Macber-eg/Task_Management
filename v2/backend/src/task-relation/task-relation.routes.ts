import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  taskRelationSchema,
  taskRelationWithTasksListSchema,
} from "./response";
import {
  createTaskRelationBody,
  taskIdParam,
  taskRelationParam,
} from "./schema";

export const getTaskRelationsRoute = createRoute({
  method: "get",
  operationId: "getTaskRelations",
  path: "/{taskId}",
  tags: ["Task Relations"],
  summary: "Get task relations",
  description:
    "Get every relation where the task is the source or the target, each with a summary of both linked tasks. Relations pointing outside the caller's workspace are omitted.",
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "Task relations with the linked task summaries",
      taskRelationWithTasksListSchema,
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
  },
});

export const createTaskRelationRoute = createRoute({
  method: "post",
  operationId: "createTaskRelation",
  path: "/",
  tags: ["Task Relations"],
  summary: "Create task relation",
  description:
    "Link two tasks. Authorization is scoped to the source task's workspace.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTaskRelationBody } },
    },
  },
  responses: {
    200: jsonResponse("The created relation", taskRelationSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Source or target task not found"),
    409: errorResponse("This relation already exists"),
  },
});

export const deleteTaskRelationRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskRelation",
  path: "/{id}",
  tags: ["Task Relations"],
  summary: "Delete task relation",
  description: "Remove a link between two tasks. Returns the deleted relation.",
  request: { params: taskRelationParam },
  responses: {
    200: jsonResponse("The deleted relation", taskRelationSchema),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task relation not found, or its source task is gone"),
  },
});
