import {
  createRoute,
  errorResponse,
  jsonResponse,
} from "../../../common/openapi";
import { deletedSchema, projectIdParam } from "../../core/schema";
import { genericWebhookIntegrationSchema } from "./response";
import { createWebhookBody, updateWebhookBody } from "./schema";

export const getGenericWebhookIntegrationRoute = createRoute({
  method: "get",
  operationId: "getGenericWebhookIntegration",
  path: "/project/{projectId}",
  tags: ["Generic Webhook"],
  summary: "Get webhook integration",
  description:
    "Get the outgoing webhook integration for a project, or null when none is configured.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Webhook integration details, or null",
      genericWebhookIntegrationSchema.nullable(),
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createGenericWebhookIntegrationRoute = createRoute({
  method: "post",
  operationId: "createGenericWebhookIntegration",
  path: "/project/{projectId}",
  tags: ["Generic Webhook"],
  summary: "Create webhook integration",
  description:
    "Create or replace the outgoing webhook for a project. Kaneo POSTs the selected task events to this URL, signed with the secret when one is set.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createWebhookBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The stored integration",
      genericWebhookIntegrationSchema.nullable(),
    ),
    400: errorResponse("The webhook URL failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateGenericWebhookIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateGenericWebhookIntegration",
  path: "/project/{projectId}",
  tags: ["Generic Webhook"],
  summary: "Update webhook integration",
  description:
    "Update the outgoing webhook. Omitted fields keep their current value, event toggles merge into the existing set, and a null secret clears it.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateWebhookBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The updated integration",
      genericWebhookIntegrationSchema.nullable(),
    ),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or webhook integration not found"),
  },
});

export const deleteGenericWebhookIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteGenericWebhookIntegration",
  path: "/project/{projectId}",
  tags: ["Generic Webhook"],
  summary: "Delete webhook integration",
  description: "Remove the outgoing webhook from a project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", deletedSchema),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or webhook integration not found"),
  },
});
