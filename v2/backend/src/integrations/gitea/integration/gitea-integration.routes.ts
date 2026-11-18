import {
  createRoute,
  errorResponse,
  jsonResponse,
} from "../../../common/openapi";
import { projectIdBody, projectIdParam } from "../../core/schema";
import {
  giteaDeleteResultSchema,
  giteaImportResultSchema,
  giteaIntegrationSchema,
  giteaRepositoryListSchema,
  giteaVerificationResultSchema,
} from "./response";
import {
  createGiteaBody,
  listGiteaRepositoriesBody,
  updateGiteaBody,
  verifyGiteaBody,
} from "./schema";

export const listGiteaRepositoriesRoute = createRoute({
  method: "post",
  operationId: "listGiteaRepositories",
  path: "/repositories",
  tags: ["Gitea"],
  summary: "List Gitea repositories",
  description:
    "List the repositories a Gitea token can reach, for picking one to link. Sent as a POST because the token travels in the body rather than the URL.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: listGiteaRepositoriesBody } },
    },
  },
  responses: {
    200: jsonResponse("Accessible repositories", giteaRepositoryListSchema),
    400: errorResponse("Invalid body, or invalid Gitea credentials"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const verifyGiteaRoute = createRoute({
  method: "post",
  operationId: "verifyGiteaAccess",
  path: "/verify",
  tags: ["Gitea"],
  summary: "Verify Gitea access",
  description:
    "Check that the base URL is a Gitea instance and that the token can reach the repository with the permissions Kaneo needs. Repository permission failures are reported in the body; invalid credentials and upstream errors return an error status. Omit accessToken to use the saved token for the unchanged base URL.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: verifyGiteaBody } },
    },
  },
  responses: {
    200: jsonResponse("Verification result", giteaVerificationResultSchema),
    401: errorResponse("Kaneo authentication required"),
    500: errorResponse("Gitea verification failed"),
    400: errorResponse("Invalid body, or invalid Gitea credentials"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const getGiteaIntegrationRoute = createRoute({
  method: "get",
  operationId: "getGiteaIntegration",
  path: "/project/{projectId}",
  tags: ["Gitea"],
  summary: "Get Gitea integration",
  description:
    "Get the Gitea integration for a project, or null when none is configured. The webhook secret is included only for callers with workspace:manage_settings.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Gitea integration details, or null",
      giteaIntegrationSchema.nullable(),
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createGiteaIntegrationRoute = createRoute({
  method: "post",
  operationId: "createGiteaIntegration",
  path: "/project/{projectId}",
  tags: ["Gitea"],
  summary: "Create Gitea integration",
  description:
    "Link a project to a Gitea repository, creating the webhook Gitea will post events to. Use the verify route first to confirm the token really reaches the repository.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createGiteaBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored integration", giteaIntegrationSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateGiteaIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateGiteaIntegration",
  path: "/project/{projectId}",
  tags: ["Gitea"],
  summary: "Update Gitea integration",
  description:
    "Update the Gitea integration. Omitted fields keep their current value.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateGiteaBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated integration", giteaIntegrationSchema),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or integration not found"),
    409: errorResponse("Integration changed; refresh before updating settings"),
  },
});

export const deleteGiteaIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteGiteaIntegration",
  path: "/project/{projectId}",
  tags: ["Gitea"],
  summary: "Delete Gitea integration",
  description: "Unlink a project from its Gitea repository.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", giteaDeleteResultSchema),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or Gitea integration not found"),
  },
});

export const importGiteaIssuesRoute = createRoute({
  method: "post",
  operationId: "importGiteaIssues",
  path: "/import-issues",
  tags: ["Gitea"],
  summary: "Import Gitea issues",
  description:
    "Import the linked repository's issues as tasks. Issues that already have a task are refreshed rather than duplicated.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: projectIdBody } },
    },
  },
  responses: {
    200: jsonResponse("Import summary", giteaImportResultSchema),
    400: errorResponse("projectId is required"),
    403: errorResponse(
      "No access to the project, or missing task:create or task:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});
