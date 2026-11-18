import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  labelListSchema,
  labelSchema,
  pendingLabelDeletionSchema,
} from "./response";
import {
  attachLabelBody,
  createLabelBody,
  labelParam,
  taskIdParam,
  updateLabelBody,
  workspaceIdParam,
} from "./schema";

export const getTaskLabelsRoute = createRoute({
  method: "get",
  operationId: "getTaskLabels",
  path: "/task/{taskId}",
  tags: ["Labels"],
  summary: "Get task labels",
  description: "Get all labels assigned to a specific task",
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of labels for the task", labelListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Task not found"),
  },
});

export const getWorkspaceLabelsRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceLabels",
  path: "/workspace/{workspaceId}",
  tags: ["Labels"],
  summary: "Get workspace labels",
  description: "Get all labels for a specific workspace",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("List of labels in the workspace", labelListSchema),
    404: errorResponse("Workspace not found"),
  },
});

export const createLabelRoute = createRoute({
  method: "post",
  operationId: "createLabel",
  path: "/",
  tags: ["Labels"],
  summary: "Create label",
  description: "Create a new label in a workspace",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createLabelBody } },
    },
  },
  responses: {
    200: jsonResponse("Label created successfully", labelSchema),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse("Missing label:create permission"),
    404: errorResponse("Workspace or task not found"),
    409: errorResponse("The workspace label is being deleted"),
  },
});

export const getLabelRoute = createRoute({
  method: "get",
  operationId: "getLabel",
  path: "/{id}",
  tags: ["Labels"],
  summary: "Get label",
  description: "Get a specific label by ID",
  request: { params: labelParam },
  responses: {
    200: jsonResponse("Label details", labelSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Label not found"),
  },
});

export const attachLabelToTaskRoute = createRoute({
  method: "put",
  operationId: "attachLabelToTask",
  path: "/{id}/task",
  tags: ["Labels"],
  summary: "Attach label to task",
  description: "Attach an existing label to a task",
  request: {
    params: labelParam,
    body: {
      required: true,
      content: { "application/json": { schema: attachLabelBody } },
    },
  },
  responses: {
    200: jsonResponse("Label attached to task successfully", labelSchema),
    400: errorResponse("Label and task belong to different workspaces"),
    403: errorResponse(
      "No access to the project, or missing label:update permission",
    ),
    404: errorResponse("Label or task not found"),
    409: errorResponse("The workspace label is being deleted"),
  },
});

export const detachLabelFromTaskRoute = createRoute({
  method: "delete",
  operationId: "detachLabelFromTask",
  path: "/{id}/task",
  tags: ["Labels"],
  summary: "Detach label from task",
  description: "Detach a label from its current task",
  request: { params: labelParam },
  responses: {
    200: jsonResponse("Label detached from task successfully", labelSchema),
    400: errorResponse("Label is not assigned to a task"),
    403: errorResponse(
      "No access to the project, or missing label:update permission",
    ),
    404: errorResponse("Label or task not found"),
  },
});

export const updateLabelRoute = createRoute({
  method: "put",
  operationId: "updateLabel",
  path: "/{id}",
  tags: ["Labels"],
  summary: "Update label",
  description: "Update an existing label",
  request: {
    params: labelParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateLabelBody } },
    },
  },
  responses: {
    200: jsonResponse("Label updated successfully", labelSchema),
    409: errorResponse("The workspace label is being deleted"),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing label:update permission",
    ),
    404: errorResponse("Label not found"),
  },
});

export const deleteLabelRoute = createRoute({
  method: "delete",
  operationId: "deleteLabel",
  path: "/{id}",
  tags: ["Labels"],
  summary: "Delete label",
  description:
    "Delete a label by ID. Large workspace cascades remove at most 25 task copies per request. Repeat DELETE with the same ID after HTTP 202 until HTTP 200 completes the operation. The persisted start boundary allows safe resumption after a disconnect. HTTP 429 asks the caller to retry later.",
  request: { params: labelParam },
  responses: {
    200: jsonResponse("Label deleted successfully", labelSchema),
    202: jsonResponse(
      "Deletion has more batches; repeat the same request",
      pendingLabelDeletionSchema,
    ),
    429: errorResponse("Deletion capacity is busy; retry after Retry-After"),
    403: errorResponse(
      "No access to the project, or missing label:delete permission",
    ),
    404: errorResponse("Label not found, or the label's task no longer exists"),
  },
});
