import {
  createRoute,
  errorResponse,
  jsonResponse,
} from "../../../common/openapi";
import { deletedSchema, projectIdParam } from "../../core/schema";
import { discordIntegrationSchema } from "./response";
import { createDiscordBody, updateDiscordBody } from "./schema";

export const getDiscordIntegrationRoute = createRoute({
  method: "get",
  operationId: "getDiscordIntegration",
  path: "/project/{projectId}",
  tags: ["Discord"],
  summary: "Get Discord integration",
  description:
    "Get the Discord integration for a project, or null when none is configured.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Discord integration details, or null",
      discordIntegrationSchema.nullable(),
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createDiscordIntegrationRoute = createRoute({
  method: "post",
  operationId: "createDiscordIntegration",
  path: "/project/{projectId}",
  tags: ["Discord"],
  summary: "Create Discord integration",
  description:
    "Create or replace the Discord integration for a project. The webhook URL is checked for shape only; delivery failures surface later.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createDiscordBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The stored integration",
      discordIntegrationSchema.nullable(),
    ),
    400: errorResponse("The webhook URL failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateDiscordIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateDiscordIntegration",
  path: "/project/{projectId}",
  tags: ["Discord"],
  summary: "Update Discord integration",
  description:
    "Update the Discord integration. Omitted fields keep their current value, and event toggles are merged into the existing set.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDiscordBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The updated integration",
      discordIntegrationSchema.nullable(),
    ),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Discord integration not found"),
  },
});

export const deleteDiscordIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteDiscordIntegration",
  path: "/project/{projectId}",
  tags: ["Discord"],
  summary: "Delete Discord integration",
  description: "Remove the Discord integration from a project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", deletedSchema),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Discord integration not found"),
  },
});
