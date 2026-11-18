import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const permissionMap = z.record(z.string(), z.array(z.string()));

export const hasPermissionRoute = createRoute({
  method: "post",
  path: "/has-permission",
  hide: true,
  request: {
    body: jsonBody(
      z
        .object({
          userId: z.coerce.string().optional(),
          role: z.string().optional(),
          permission: permissionMap.optional(),
          permissions: permissionMap.optional(),
        })
        .refine(
          (body) => (body.permission === undefined) !== (body.permissions === undefined),
          { message: "Pass either permission or permissions" },
        ),
    ),
  },
  responses: { 200: jsonResponse("Whether the caller has them", anyJson) },
});

export const updateUserRoute = createRoute({
  method: "post",
  path: "/update-user",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        userId: z.coerce.string(),
        data: z.record(z.string(), z.unknown()),
      }),
    ),
  },
  responses: { 200: jsonResponse("The updated user", anyJson) },
});

export const setRoleRoute = createRoute({
  method: "post",
  path: "/set-role",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        userId: z.coerce.string(),
        role: z.union([z.string(), z.array(z.string())]),
      }),
    ),
  },
  responses: { 200: jsonResponse("The user with the new role", anyJson) },
});

export const banUserRoute = createRoute({
  method: "post",
  path: "/ban-user",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        userId: z.coerce.string(),
        banReason: z.string().optional(),
        banExpiresIn: z.number().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The banned user", anyJson) },
});

export const unbanUserRoute = createRoute({
  method: "post",
  path: "/unban-user",
  hide: true,
  request: {
    body: jsonBody(z.object({ userId: z.coerce.string() })),
  },
  responses: { 200: jsonResponse("The reinstated user", anyJson) },
});

export const removeUserRoute = createRoute({
  method: "post",
  path: "/remove-user",
  hide: true,
  request: {
    body: jsonBody(z.object({ userId: z.unknown() })),
  },
  responses: { 200: jsonResponse("The user was removed", anyJson) },
});
