import {
  createRoute,
  errorResponse,
  jsonResponse,
} from "../../../common/openapi";
import { projectIdBody, projectIdParam } from "../../core/schema";
import {
  gitlabDeleteResultSchema,
  gitlabImportResultSchema,
  gitlabIntegrationSchema,
  gitlabProjectListSchema,
  gitlabVerificationResultSchema,
} from "./response";
import {
  createGitlabBody,
  listGitlabProjectsBody,
  updateGitlabBody,
  verifyGitlabBody,
} from "./schema";

export const listGitlabProjectsRoute = createRoute({
  method: "post",
  operationId: "listGitlabProjects",
  path: "/projects",
  tags: ["GitLab"],
  summary: "List GitLab projects",
  description:
    "List the projects a GitLab token is a member of, for picking one to link. Sent as a POST because the token travels in the body rather than the URL.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: listGitlabProjectsBody } },
    },
  },
  responses: {
    200: jsonResponse("Accessible projects", gitlabProjectListSchema),
    400: errorResponse("Invalid body"),
    401: errorResponse(
      "GitLab rejected the token, or the instance is unreachable",
    ),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const verifyGitlabRoute = createRoute({
  method: "post",
  operationId: "verifyGitlabAccess",
  path: "/verify",
  tags: ["GitLab"],
  summary: "Verify GitLab access",
  description:
    "Check that the base URL is a GitLab instance and that the token can reach the project with the permissions Kaneo needs. An unreachable instance, a missing project, or insufficient permissions are reported in a 200 body so the form can explain them; a token GitLab rejects outright is a 401.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: verifyGitlabBody } },
    },
  },
  responses: {
    200: jsonResponse("Verification result", gitlabVerificationResultSchema),
    400: errorResponse("Invalid body"),
    401: errorResponse("GitLab rejected the token"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const getGitlabIntegrationRoute = createRoute({
  method: "get",
  operationId: "getGitlabIntegration",
  path: "/project/{projectId}",
  tags: ["GitLab"],
  summary: "Get GitLab integration",
  description:
    "Get the GitLab integration for a project, or null when none is configured. The masked access token and the webhook secret are included only for callers with workspace:manage_settings.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "GitLab integration details, or null",
      gitlabIntegrationSchema.nullable(),
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createGitlabIntegrationRoute = createRoute({
  method: "post",
  operationId: "createGitlabIntegration",
  path: "/project/{projectId}",
  tags: ["GitLab"],
  summary: "Create GitLab integration",
  description:
    "Link a project to a GitLab project. Kaneo generates the secret GitLab must send with each webhook; add the webhook in GitLab afterwards. Use the verify route first to confirm the token really reaches the project.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createGitlabBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored integration", gitlabIntegrationSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    409: errorResponse(
      "That GitLab project is already linked to another Kaneo project",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateGitlabIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateGitlabIntegration",
  path: "/project/{projectId}",
  tags: ["GitLab"],
  summary: "Update GitLab integration",
  description:
    "Update the GitLab integration. Omitted fields keep their current value.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateGitlabBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated integration", gitlabIntegrationSchema),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or integration not found"),
    409: errorResponse("Integration changed; refresh before updating settings"),
  },
});

export const deleteGitlabIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteGitlabIntegration",
  path: "/project/{projectId}",
  tags: ["GitLab"],
  summary: "Delete GitLab integration",
  description: "Unlink a project from its GitLab project.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", gitlabDeleteResultSchema),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or GitLab integration not found"),
  },
});

export const importGitlabIssuesRoute = createRoute({
  method: "post",
  operationId: "importGitlabIssues",
  path: "/import-issues",
  tags: ["GitLab"],
  summary: "Import GitLab issues",
  description:
    "Import the linked project's open issues as tasks. Issues that already have a task are refreshed rather than duplicated. Requires task:create and task:update permissions.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: projectIdBody } },
    },
  },
  responses: {
    200: jsonResponse("Import summary", gitlabImportResultSchema),
    400: errorResponse("projectId is required"),
    403: errorResponse(
      "No access to the project, or missing task:create or task:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});
