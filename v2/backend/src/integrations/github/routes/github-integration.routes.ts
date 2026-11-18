import { createRoute, errorResponse, jsonResponse } from "../../../common/openapi";
import { projectIdParam } from "../../core/schema";
import {
  createdGithubIntegrationSchema,
  deleteResultSchema,
  githubAppInfoSchema,
  githubIntegrationSchema,
  githubRepositoryListSchema,
  importResultSchema,
  verificationResultSchema,
} from "./response";
import {
  createGitHubBody,
  importGitHubBody,
  repositoryPageQuery,
  updateGitHubBody,
  verifyGitHubBody,
} from "./schema";

export const getAppInfoRoute = createRoute({
  method: "get",
  operationId: "getGitHubAppInfo",
  path: "/app-info",
  tags: ["GitHub"],
  summary: "Get GitHub app info",
  description:
    "Get the GitHub App this instance is configured with, so the client can build an install link.",
  responses: {
    200: jsonResponse("GitHub app information", githubAppInfoSchema),
  },
});

export const listRepositoriesRoute = createRoute({
  method: "get",
  operationId: "listGitHubRepositories",
  path: "/repositories/{projectId}",
  tags: ["GitHub"],
  summary: "List GitHub repositories",
  description:
    "List the repositories reachable through the installed GitHub App, for picking one to link.",
  request: { params: projectIdParam, query: repositoryPageQuery },
  responses: {
    200: jsonResponse(
      "Repositories reachable through the installed App",
      githubRepositoryListSchema,
    ),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const verifyRoute = createRoute({
  method: "post",
  operationId: "verifyGitHubInstallation",
  path: "/verify",
  tags: ["GitHub"],
  summary: "Verify GitHub installation",
  description:
    "Check that the GitHub App is installed on a repository and holds the permissions Kaneo needs. Always 200 -- problems are reported in the body so the client can guide the user.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: verifyGitHubBody } },
    },
  },
  responses: {
    200: jsonResponse("Verification result", verificationResultSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const getIntegrationRoute = createRoute({
  method: "get",
  operationId: "getGitHubIntegration",
  path: "/project/{projectId}",
  tags: ["GitHub"],
  summary: "Get GitHub integration",
  description:
    "Get the GitHub integration for a project, or null when none is configured.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "GitHub integration details, or null",
      githubIntegrationSchema.nullable(),
    ),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const createIntegrationRoute = createRoute({
  method: "post",
  operationId: "createGitHubIntegration",
  path: "/project/{projectId}",
  tags: ["GitHub"],
  summary: "Create GitHub integration",
  description:
    "Link a project to a GitHub repository. Disconnect first to switch repositories; existing issue and pull request links cannot be reused for another repository.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createGitHubBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored integration", createdGithubIntegrationSchema),
    409: errorResponse(
      "Integration changed or another repository is already linked",
    ),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project not found"),
  },
});

export const updateIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateGitHubIntegration",
  path: "/project/{projectId}",
  tags: ["GitHub"],
  summary: "Update GitHub integration",
  description:
    "Update the GitHub integration. Omitted fields keep their current value.",
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateGitHubBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The updated integration",
      githubIntegrationSchema.nullable(),
    ),
    409: errorResponse(
      "Integration changed or another repository is already linked",
    ),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or integration not found"),
  },
});

export const deleteIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteGitHubIntegration",
  path: "/project/{projectId}",
  tags: ["GitHub"],
  summary: "Delete GitHub integration",
  description: "Unlink a project from its GitHub repository.",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", deleteResultSchema),
    403: errorResponse(
      "No access to the project, or missing workspace:manage_settings",
    ),
    404: errorResponse("Project or GitHub integration not found"),
  },
});

export const importIssuesRoute = createRoute({
  method: "post",
  operationId: "importGitHubIssues",
  path: "/import-issues",
  tags: ["GitHub"],
  summary: "Import GitHub issues",
  description:
    "Import open issues and link open pull requests in bounded steps. Existing tasks are updated. Continue 202 responses with the returned runId until 200; the same runId safely retries completion. Progress is saved after each page. New calls without runId resume an unfinished import or start a new one after completion.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: importGitHubBody } },
    },
  },
  responses: {
    200: jsonResponse("Completed import summary", importResultSchema),
    202: jsonResponse(
      "Saved import progress; continue with runId",
      importResultSchema,
    ),
    409: errorResponse(
      "Integration or import changed; refresh before resuming",
    ),
    429: errorResponse("Import busy; retry after one second"),
    502: errorResponse(
      "Provider unavailable or invalid page; progress is saved",
    ),
    400: errorResponse("projectId is required"),
    403: errorResponse(
      "No access to the project, or missing task:create or task:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});
