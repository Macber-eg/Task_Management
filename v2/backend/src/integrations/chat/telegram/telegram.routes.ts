import {
  createRoute,
  errorResponse,
  jsonResponse,
} from "../../../common/openapi";
import { deletedSchema, projectIdParam } from "../../core/schema";
import { telegramIntegrationSchema } from "./response";
import { createTelegramBody, updateTelegramBody } from "./schema";

export const getTelegramIntegrationRoute = createRoute({
  method: "get",
  operationId: "getTelegramIntegration",
  path: "/project/{projectId}",
  tags: ["Telegram"],
  summary: "Get Telegram integration",
  description:
    "Get the Telegram integration for a project, or null when none is configured.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Telegram integration details, or null",
      telegramIntegrationSchema.nullable(),
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createTelegramIntegrationRoute = createRoute({
  method: "post",
  operationId: "createTelegramIntegration",
  path: "/project/{projectId}",
  tags: ["Telegram"],
  summary: "Create Telegram integration",
  description:
    "Create or replace the Telegram integration for a project. The bot token and chat are checked for shape only, not against Telegram.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createTelegramBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The stored integration",
      telegramIntegrationSchema.nullable(),
    ),
    400: errorResponse("The bot token or chat failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateTelegramIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateTelegramIntegration",
  path: "/project/{projectId}",
  tags: ["Telegram"],
  summary: "Update Telegram integration",
  description:
    "Update the Telegram integration. Omitted fields keep their current value; threadId and chatLabel accept null to clear them.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTelegramBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The updated integration",
      telegramIntegrationSchema.nullable(),
    ),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Telegram integration not found"),
  },
});

export const deleteTelegramIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteTelegramIntegration",
  path: "/project/{projectId}",
  tags: ["Telegram"],
  summary: "Delete Telegram integration",
  description: "Remove the Telegram integration from a project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", deletedSchema),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Telegram integration not found"),
  },
});
