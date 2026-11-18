import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  customFieldDefinitionListSchema,
  customFieldDefinitionSchema,
  customFieldFilterValuesListSchema,
  customFieldValueListSchema,
  reorderCustomFieldsResponseSchema,
  setCustomFieldValueResponseSchema,
} from "./response";
import {
  createCustomFieldBody,
  customFieldIdParam,
  projectIdParam,
  reorderCustomFieldsBody,
  setCustomFieldValueBody,
  taskIdParam,
} from "./schema";

export const getCustomFieldsRoute = createRoute({
  method: "get",
  operationId: "getCustomFieldsByProject",
  path: "/project/{projectId}",
  tags: ["Custom Fields"],
  summary: "Get custom fields",
  description: "Get all custom field definitions for a project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "List of custom field definitions",
      customFieldDefinitionListSchema,
    ),
    403: errorResponse("No access to the project, or missing read permission"),
    404: errorResponse("Project not found"),
  },
});

export const getCustomFieldValuesByProjectRoute = createRoute({
  method: "get",
  operationId: "getCustomFieldValuesByProject",
  path: "/project/{projectId}/values",
  tags: ["Custom Fields"],
  summary: "Get project custom field values",
  description: "Get all custom field values for every task in a project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "List of custom field values for the project",
      customFieldValueListSchema,
    ),
    403: errorResponse("No access to the project, or missing read permission"),
    404: errorResponse("Project not found"),
  },
});

export const getCustomFieldValuesByTaskRoute = createRoute({
  method: "get",
  operationId: "getCustomFieldValuesByTask",
  path: "/task/{taskId}",
  tags: ["Custom Fields"],
  summary: "Get task custom field values",
  description: "Get all custom field values for a task with their definitions.",
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "List of custom field values for the task",
      customFieldValueListSchema,
    ),
    403: errorResponse(
      "No access to the project, or missing task:read permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const getCustomFieldFilterValuesRoute = createRoute({
  method: "get",
  operationId: "getCustomFieldFilterValues",
  path: "/project/{projectId}/filter-values",
  tags: ["Custom Fields"],
  summary: "Get custom field filter values",
  description:
    "Get distinct values used by tasks for each custom field of a project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Distinct values used for each custom field",
      customFieldFilterValuesListSchema,
    ),
    403: errorResponse("No access to the project, or missing read permission"),
    404: errorResponse("Project not found"),
  },
});

export const createCustomFieldRoute = createRoute({
  method: "post",
  operationId: "createCustomField",
  path: "/",
  tags: ["Custom Fields"],
  summary: "Create custom field",
  description: "Create a custom field definition for a project.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCustomFieldBody } },
    },
  },
  responses: {
    200: jsonResponse("The created custom field", customFieldDefinitionSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const reorderCustomFieldsRoute = createRoute({
  method: "put",
  operationId: "reorderCustomFields",
  path: "/reorder/{projectId}",
  tags: ["Custom Fields"],
  summary: "Reorder custom fields",
  description: "Set new positions for a project's custom fields.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: reorderCustomFieldsBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The reordered custom fields",
      reorderCustomFieldsResponseSchema,
    ),
    400: errorResponse("A custom field does not belong to this project"),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const setCustomFieldValueRoute = createRoute({
  method: "put",
  operationId: "setCustomFieldValue",
  path: "/value",
  tags: ["Custom Fields"],
  summary: "Set custom field value",
  description: "Create or update a custom field value for a task.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: setCustomFieldValueBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The saved custom field value",
      setCustomFieldValueResponseSchema,
    ),
    400: errorResponse("Invalid body, or unknown custom field"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

export const deleteCustomFieldRoute = createRoute({
  method: "delete",
  operationId: "deleteCustomField",
  path: "/{id}",
  tags: ["Custom Fields"],
  summary: "Delete custom field",
  description: "Delete a custom field definition by ID.",
  request: { params: customFieldIdParam },
  responses: {
    200: jsonResponse("The deleted custom field", customFieldDefinitionSchema),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Custom field not found"),
  },
});
