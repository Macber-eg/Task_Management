import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  memberProjectAccessListSchema,
  memberProjectAccessSchema,
  workspaceCapabilitiesSchema,
  workspaceListSchema,
  workspaceMemberListSchema,
  workspaceSchema,
} from "./response";
import {
  updateMemberProjectAccessBody,
  workspaceIdParam,
  workspaceMemberParam,
  workspaceMembersQuery,
} from "./schema";

export const listWorkspacesRoute = createRoute({
  method: "get",
  operationId: "listWorkspaces",
  path: "/",
  tags: ["Workspaces"],
  summary: "List workspaces",
  description:
    "List the workspaces where one of the caller's roles grants workspace:read, with the caller's role, sorted by name. Instance admins get every workspace they are a member of, and only those.",
  responses: {
    200: jsonResponse("The caller's workspaces", workspaceListSchema),
    403: errorResponse("The API key lacks workspace:read"),
  },
});

export const getWorkspaceRoute = createRoute({
  method: "get",
  operationId: "getWorkspace",
  path: "/{workspaceId}",
  tags: ["Workspaces"],
  summary: "Get workspace",
  description:
    "Get a workspace where one of the caller's roles grants workspace:read, with the caller's role. Instance admins can get any workspace, with a null role when they are not a member.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The workspace", workspaceSchema),
    403: errorResponse("The API key lacks workspace:read"),
    404: errorResponse(
      "Workspace not found, the caller is not a member of it, or none of their roles grants workspace:read",
    ),
  },
});

export const getWorkspaceMembersRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceMembers",
  path: "/{workspaceId}/members",
  tags: ["Workspaces"],
  summary: "Get workspace members",
  description:
    "Get all members of a workspace, with their role. Pass projectId to get only the members who can access that project.",
  request: { params: workspaceIdParam, query: workspaceMembersQuery },
  responses: {
    200: jsonResponse("List of workspace members", workspaceMemberListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse(
      "Workspace not found, or project not found in this workspace",
    ),
  },
});

export const getWorkspaceProjectAccessRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceProjectAccess",
  path: "/{workspaceId}/project-access",
  tags: ["Workspaces"],
  summary: "Get member project access",
  description:
    "List the members who are limited to selected projects, with the projects each one can access. Everyone else in the workspace can access every project. A caller whose own access is limited only sees the projects they can access.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "Members limited to selected projects",
      memberProjectAccessListSchema,
    ),
    403: errorResponse("Missing member:update permission"),
    404: errorResponse("Workspace not found"),
  },
});

export const getMyProjectAccessRoute = createRoute({
  method: "get",
  operationId: "getMyProjectAccess",
  path: "/{workspaceId}/project-access/me",
  tags: ["Workspaces"],
  summary: "Get my project access",
  description:
    "Get the caller's own project access in the workspace: every project, or the selected projects they're limited to. Owners and instance admins always get every project.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The caller's project access", memberProjectAccessSchema),
    404: errorResponse("Workspace not found"),
  },
});

export const getMyCapabilitiesRoute = createRoute({
  method: "get",
  operationId: "getMyWorkspaceCapabilities",
  path: "/{workspaceId}/capabilities",
  tags: ["Workspaces"],
  summary: "Get my workspace capabilities",
  description:
    "Check every named workspace action for the caller in one request: which of them the caller's roles allow, narrowed by the API key's scope when one is used. Instance admins are allowed everything.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "The caller's capabilities in the workspace",
      workspaceCapabilitiesSchema,
    ),
    404: errorResponse("Workspace not found"),
  },
});

export const updateMemberProjectAccessRoute = createRoute({
  method: "put",
  operationId: "updateMemberProjectAccess",
  path: "/{workspaceId}/members/{userId}/project-access",
  tags: ["Workspaces"],
  summary: "Update member project access",
  description:
    "Give a member access to every project, or limit them to selected projects. Owners always access every project, and you can't change your own access or give access to projects you can't access yourself.",
  request: {
    params: workspaceMemberParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: updateMemberProjectAccessBody },
      },
    },
  },
  responses: {
    200: jsonResponse("The member's project access", memberProjectAccessSchema),
    400: errorResponse(
      "Invalid body, the member is an owner, or a project is not in this workspace",
    ),
    403: errorResponse(
      "Missing member:update permission, changing your own access, or granting a project you can't access",
    ),
    404: errorResponse("Workspace or member not found"),
  },
});
