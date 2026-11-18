import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  importRunEnvelopeSchema,
  importRunListSchema,
  importSourceProjectListSchema,
  trelloAuthorizeUrlSchema,
} from "./response";
import {
  importRunParam,
  listImportSourceProjectsBody,
  startImportRunBody,
  workspaceIdParam,
} from "./schema";

const forbidden = errorResponse(
  "Missing workspace:manage_settings or project:create permission",
);

export const listImportSourceProjectsRoute = createRoute({
  method: "post",
  operationId: "listImportSourceProjects",
  path: "/projects",
  tags: ["Import"],
  summary: "List projects in an import source",
  description:
    "Sign in to PLANKA, Plane, Linear, Trello or another Kaneo instance and list the projects that can be imported. The credentials are used only for this request; they are never stored, logged, or returned.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: listImportSourceProjectsBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Projects available in the source",
      importSourceProjectListSchema,
    ),
    400: errorResponse(
      "Invalid body, credentials the source rejected, or a destination this server may not reach",
    ),
    402: errorResponse("Workspace plan has expired"),
    403: forbidden,
    404: errorResponse("Workspace not found"),
    502: errorResponse(
      "The source could not be reached or answered with an error",
    ),
  },
});

export const startImportRunRoute = createRoute({
  method: "post",
  operationId: "startImportRun",
  path: "/runs",
  tags: ["Import"],
  summary: "Start an import",
  description:
    "Import the selected source projects into the workspace as new Kaneo projects. The import runs in the background; poll getImportRun for progress. The credentials are held in memory only while the import runs; they are never stored, logged, or returned. Imported tasks do not send notifications or trigger integrations.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: startImportRunBody } },
    },
  },
  responses: {
    202: jsonResponse("The import started", importRunEnvelopeSchema),
    400: errorResponse(
      "Invalid body, credentials the source rejected, a destination this server may not reach, or a selected project the source no longer lists",
    ),
    402: errorResponse("Workspace plan has expired"),
    403: forbidden,
    404: errorResponse("Workspace not found"),
    409: errorResponse("Another import is already running in this workspace"),
    429: errorResponse(
      "This server is already running its maximum number of imports, or the API key exceeded its rate limit",
    ),
    502: errorResponse(
      "The source could not be reached or answered with an error",
    ),
    503: errorResponse("The server is restarting and not starting new imports"),
  },
});

export const listImportRunsRoute = createRoute({
  method: "get",
  operationId: "listImportRuns",
  path: "/runs/{workspaceId}",
  tags: ["Import"],
  summary: "List imports",
  description:
    "The workspace's 20 most recent imports, newest first. A run whose server stopped reporting progress is returned as failed.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Recent imports", importRunListSchema),
    403: forbidden,
    404: errorResponse("Workspace not found"),
  },
});

export const getImportRunRoute = createRoute({
  method: "get",
  operationId: "getImportRun",
  path: "/runs/{workspaceId}/{runId}",
  tags: ["Import"],
  summary: "Get an import",
  description:
    "Progress and outcome of one import, including each project's status, counts and warnings.",
  request: { params: importRunParam },
  responses: {
    200: jsonResponse("The import", importRunEnvelopeSchema),
    403: forbidden,
    404: errorResponse("Workspace or import not found"),
  },
});

export const getTrelloAuthorizeUrlRoute = createRoute({
  method: "get",
  operationId: "getTrelloAuthorizeUrl",
  path: "/trello/authorize-url/{workspaceId}",
  tags: ["Import"],
  summary: "Get the Trello authorize link",
  description:
    "Link to Trello's authorize page for this server's Trello app, where the user approves read access and copies a token for startImportRun. null when the server has no TRELLO_API_KEY.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The Trello authorize link", trelloAuthorizeUrlSchema),
    403: forbidden,
    404: errorResponse("Workspace not found"),
  },
});
