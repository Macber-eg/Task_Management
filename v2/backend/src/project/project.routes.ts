import { createRoute, errorResponse, jsonResponse, z } from "../common/openapi";
import {
  movedProjectSchema,
  projectListSchema,
  projectSchema,
} from "./response";
import {
  createProjectBody,
  listProjectsQuery,
  moveProjectBody,
  projectParam,
  reorderProjectsBody,
  updateProjectBody,
  workspaceIdQuery,
} from "./schema";

export const moveProjectRoute = createRoute({
  method: "put",
  path: "/{id}/move",
  operationId: "moveProject",
  tags: ["Projects"],
  summary: "Move a project to another workspace",
  description:
    "Move a project and its tasks. Requires update and delete permission in the source, plus project creation and workspace settings management permission in the destination. Remove cross-project task relationships before moving.",
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: moveProjectBody } },
    },
  },
  responses: {
    200: jsonResponse("Project moved", movedProjectSchema),
    400: errorResponse("Invalid destination or same workspace"),
    401: errorResponse("Unauthorized"),
    402: errorResponse("Destination workspace plan has expired"),
    403: errorResponse(
      "No access to the project, or missing permission in the source or destination workspace",
    ),
    404: errorResponse("Project or destination workspace not found"),
    409: errorResponse(
      "Project key conflict or cross-project task relationships",
    ),
  },
});

export const listProjectsRoute = createRoute({
  method: "get",
  operationId: "listProjects",
  path: "/",
  tags: ["Projects"],
  summary: "List projects",
  description:
    "List a workspace's projects in sidebar order, each with rollup task statistics. Archived projects are excluded unless includeArchived is set.",
  request: { query: listProjectsQuery },
  responses: {
    200: jsonResponse("List of projects", projectListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    404: errorResponse("Workspace not found"),
  },
});

export const createProjectRoute = createRoute({
  method: "post",
  operationId: "createProject",
  path: "/",
  tags: ["Projects"],
  summary: "Create project",
  description:
    "Create a project in a workspace. The slug becomes the prefix of its task identifiers.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createProjectBody } },
    },
  },
  responses: {
    200: jsonResponse("The created project", projectSchema),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse("Missing project:create permission"),
    409: errorResponse("Another project in the workspace uses this key"),
    404: errorResponse("Workspace not found"),
  },
});

export const getProjectRoute = createRoute({
  method: "get",
  operationId: "getProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Get project",
  description: "Get a single project by ID.",
  request: { params: projectParam },
  responses: {
    200: jsonResponse("Project details", projectSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

export const reorderProjectsRoute = createRoute({
  method: "put",
  operationId: "reorderProjects",
  path: "/reorder",
  tags: ["Projects"],
  summary: "Reorder projects",
  description:
    "Set the sidebar order of a workspace's projects. The given positions express relative order only -- the workspace is renumbered to 0..n-1.",
  request: {
    query: workspaceIdQuery,
    body: {
      required: true,
      content: { "application/json": { schema: reorderProjectsBody } },
    },
  },
  responses: {
    // Reorder returns the plain project rows, without the list route's
    // rollup statistics.
    200: jsonResponse("The reordered projects", z.array(projectSchema)),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse(
      "Missing project:update permission, or no access to a listed project",
    ),
    404: errorResponse("Workspace not found"),
  },
});

export const updateProjectRoute = createRoute({
  method: "put",
  operationId: "updateProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Update project",
  description:
    "Replace a project's name, icon, slug, description, and visibility.",
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateProjectBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated project", projectSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No access to the project, missing project:update, or missing project:share when visibility changes",
    ),
    409: errorResponse("Another project in the workspace uses the new key"),
    404: errorResponse("Project not found"),
  },
});

export const deleteProjectRoute = createRoute({
  method: "delete",
  operationId: "deleteProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Delete project",
  description:
    "Permanently delete a project and everything in it. Archive it instead to keep the data.",
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The deleted project", projectSchema),
    403: errorResponse(
      "No access to the project, or missing project:delete permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const archiveProjectRoute = createRoute({
  method: "put",
  operationId: "archiveProject",
  path: "/{id}/archive",
  tags: ["Projects"],
  summary: "Archive project",
  description:
    "Hide a project from the default list without deleting it. Reversible with unarchive.",
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The archived project", projectSchema),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});

export const unarchiveProjectRoute = createRoute({
  method: "put",
  operationId: "unarchiveProject",
  path: "/{id}/unarchive",
  tags: ["Projects"],
  summary: "Unarchive project",
  description: "Return an archived project to the default list.",
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The restored project", projectSchema),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    409: errorResponse("Another project in the workspace uses this key"),
    404: errorResponse("Project not found"),
  },
});
