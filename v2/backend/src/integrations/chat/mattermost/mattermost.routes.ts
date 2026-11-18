import {
  createRoute,
  errorResponse,
  jsonResponse,
} from "../../../common/openapi";
import { deletedSchema, projectIdParam } from "../../core/schema";
import { mattermostIntegrationSchema } from "./response";
import { createMattermostBody, updateMattermostBody } from "./schema";

export const getMattermostIntegrationRoute = createRoute({
  method: "get",
  operationId: "getMattermostIntegration",
  path: "/project/{projectId}",
  tags: ["Mattermost"],
  summary: "Get Mattermost integration",
  description:
    "Get the Mattermost integration for a project, or null when none is configured.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Mattermost integration details, or null",
      mattermostIntegrationSchema.nullable(),
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createMattermostIntegrationRoute = createRoute({
  method: "post",
  operationId: "createMattermostIntegration",
  path: "/project/{projectId}",
  tags: ["Mattermost"],
  summary: "Create Mattermost integration",
  description:
    "Create or replace the Mattermost integration for a project. The webhook URL must use HTTPS and pass destination validation; delivery failures surface later.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createMattermostBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The stored integration",
      mattermostIntegrationSchema.nullable(),
    ),
    400: errorResponse("The webhook URL failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateMattermostIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateMattermostIntegration",
  path: "/project/{projectId}",
  tags: ["Mattermost"],
  summary: "Update Mattermost integration",
  description:
    "Update the Mattermost integration. Omitted fields keep their current value, and event toggles are merged into the existing set.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateMattermostBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The updated integration",
      mattermostIntegrationSchema.nullable(),
    ),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Mattermost integration not found"),
  },
});

export const deleteMattermostIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteMattermostIntegration",
  path: "/project/{projectId}",
  tags: ["Mattermost"],
  summary: "Delete Mattermost integration",
  description: "Remove the Mattermost integration from a project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", deletedSchema),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Mattermost integration not found"),
  },
});
