import { createRoute, jsonResponse, z } from "../../common/openapi";
import { MEMBER_FILTER_OPERATORS } from "./member-list-sql";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const roleInput = z.union([z.string(), z.array(z.string())]);

export const leaveOrganizationRoute = createRoute({
  method: "post",
  path: "/leave",
  hide: true,
  request: { body: jsonBody(z.object({ organizationId: z.string() })) },
  responses: { 200: jsonResponse("The membership that ended", anyJson) },
});

export const listMembersRoute = createRoute({
  method: "get",
  path: "/list-members",
  hide: true,
  request: {
    query: z.object({
      limit: z.string().or(z.number()).optional(),
      offset: z.string().or(z.number()).optional(),
      sortBy: z.string().optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
      filterField: z.string().optional(),
      filterValue: z
        .string()
        .or(z.number())
        .or(z.boolean())
        .or(z.array(z.string()))
        .or(z.array(z.number()))
        .optional(),
      filterOperator: z.enum(MEMBER_FILTER_OPERATORS).optional(),
      organizationId: z.string().optional(),
      organizationSlug: z.string().optional(),
    }),
  },
  responses: { 200: jsonResponse("Members and their total", anyJson) },
});

export const getActiveMemberRoute = createRoute({
  method: "get",
  path: "/get-active-member",
  hide: true,
  responses: { 200: jsonResponse("The caller's membership", anyJson) },
});

export const getActiveMemberRoleRoute = createRoute({
  method: "get",
  path: "/get-active-member-role",
  hide: true,
  request: {
    query: z.object({
      userId: z.string().optional(),
      organizationId: z.string().optional(),
      organizationSlug: z.string().optional(),
    }),
  },
  responses: { 200: jsonResponse("The member's role", anyJson) },
});

export const updateMemberRoleRoute = createRoute({
  method: "post",
  path: "/update-member-role",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        role: roleInput,
        memberId: z.string(),
        organizationId: z.string().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The updated membership", anyJson) },
});

export const removeMemberRoute = createRoute({
  method: "post",
  path: "/remove-member",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        memberIdOrEmail: z.string(),
        organizationId: z.string().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The removed membership", anyJson) },
});
