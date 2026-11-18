import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const invitationIdBody = jsonBody(z.object({ invitationId: z.string() }));

export const inviteMemberRoute = createRoute({
  method: "post",
  path: "/invite-member",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        email: z.string(),
        role: z.union([z.string(), z.array(z.string())]),
        organizationId: z.string().optional(),
        resend: z.boolean().optional(),
        teamId: z.union([z.string().optional(), z.array(z.string()).optional()]),
        projectAccess: z.string().nullish(),
        projectIds: z.array(z.string()).nullish(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The invitation", anyJson) },
});

export const acceptInvitationRoute = createRoute({
  method: "post",
  path: "/accept-invitation",
  hide: true,
  request: { body: invitationIdBody },
  responses: { 200: jsonResponse("The invitation and membership", anyJson) },
});

export const rejectInvitationRoute = createRoute({
  method: "post",
  path: "/reject-invitation",
  hide: true,
  request: { body: invitationIdBody },
  responses: { 200: jsonResponse("The rejected invitation", anyJson) },
});

export const cancelInvitationRoute = createRoute({
  method: "post",
  path: "/cancel-invitation",
  hide: true,
  request: { body: invitationIdBody },
  responses: { 200: jsonResponse("The canceled invitation", anyJson) },
});

export const getInvitationRoute = createRoute({
  method: "get",
  path: "/get-invitation",
  hide: true,
  request: { query: z.object({ id: z.string() }) },
  responses: { 200: jsonResponse("The invitation", anyJson) },
});

export const listInvitationsRoute = createRoute({
  method: "get",
  path: "/list-invitations",
  hide: true,
  request: { query: z.object({ organizationId: z.string().optional() }) },
  responses: { 200: jsonResponse("The workspace's invitations", anyJson) },
});

export const listUserInvitationsRoute = createRoute({
  method: "get",
  path: "/list-user-invitations",
  hide: true,
  request: { query: z.object({ email: z.string().optional() }) },
  responses: { 200: jsonResponse("Invitations addressed to the caller", anyJson) },
});
