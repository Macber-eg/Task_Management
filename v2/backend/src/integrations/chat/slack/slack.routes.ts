import {
  createRoute,
  errorResponse,
  jsonResponse,
} from "../../../common/openapi";
import { deletedSchema, projectIdParam } from "../../core/schema";
import { slackIntegrationSchema } from "./response";
import { createSlackBody, updateSlackBody } from "./schema";

export const getSlackIntegrationRoute = createRoute({
  method: "get",
  operationId: "getSlackIntegration",
  path: "/project/{projectId}",
  tags: ["Slack"],
  summary: "Get Slack integration",
  description:
    "Get the Slack integration for a project, or null when none is configured.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Slack integration details, or null",
      slackIntegrationSchema.nullable(),
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createSlackIntegrationRoute = createRoute({
  method: "post",
  operationId: "createSlackIntegration",
  path: "/project/{projectId}",
  tags: ["Slack"],
  summary: "Create Slack integration",
  description:
    "Create or replace the Slack integration for a project. The webhook URL is checked for shape only; delivery failures surface later.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createSlackBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The stored integration",
      slackIntegrationSchema.nullable(),
    ),
    400: errorResponse("The webhook URL failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateSlackIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateSlackIntegration",
  path: "/project/{projectId}",
  tags: ["Slack"],
  summary: "Update Slack integration",
  description:
    "Update the Slack integration. Omitted fields keep their current value, and event toggles are merged into the existing set.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateSlackBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The updated integration",
      slackIntegrationSchema.nullable(),
    ),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Slack integration not found"),
  },
});

export const deleteSlackIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteSlackIntegration",
  path: "/project/{projectId}",
  tags: ["Slack"],
  summary: "Delete Slack integration",
  description: "Remove the Slack integration from a project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", deletedSchema),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Slack integration not found"),
  },
});
