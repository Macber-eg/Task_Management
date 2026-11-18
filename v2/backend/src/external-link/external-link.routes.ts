import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  createdExternalLinkSchema,
  deletedExternalLinkSchema,
  externalLinkListSchema,
} from "./response";
import {
  createExternalLinkBody,
  deleteExternalLinkParam,
  taskIdParam,
} from "./schema";

export const createExternalLinkRoute = createRoute({
  method: "post",
  operationId: "createExternalLink",
  path: "/task/{taskId}",
  tags: ["External Links"],
  summary: "Create an external link",
  description: "Add a resource link to a task",
  request: {
    params: taskIdParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createExternalLinkBody,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "External link created successfully",
      createdExternalLinkSchema,
    ),
    400: errorResponse("Invalid external link data"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("No permission to update the task"),
    404: errorResponse("Task not found"),
  },
});

export const deleteExternalLinkRoute = createRoute({
  method: "delete",
  operationId: "deleteExternalLink",
  path: "/task/{taskId}/{id}",
  tags: ["External Links"],
  summary: "Remove a manual resource link",
  description:
    "Remove a manually added link from a task. Integration-managed links cannot be removed through this endpoint.",
  request: { params: deleteExternalLinkParam },
  responses: {
    200: jsonResponse("Resource link removed", deletedExternalLinkSchema),
    400: errorResponse("Invalid link data"),
    401: errorResponse("Unauthorized"),
    403: errorResponse("No permission to update the task"),
    404: errorResponse("Task or manual resource link not found"),
  },
});

export const getExternalLinksByTaskRoute = createRoute({
  method: "get",
  operationId: "getExternalLinksByTask",
  path: "/task/{taskId}",
  tags: ["External Links"],
  summary: "Get task external links",
  description:
    "Get manually added resource links and links from connected integrations, such as GitHub or Gitea issues.",
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("External links for the task", externalLinkListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
  },
});
