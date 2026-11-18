import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const permissionMap = z.record(z.string(), z.array(z.string()));

const roleSelector = z.union([
  z.object({ roleName: z.string().nonempty() }),
  z.object({ roleId: z.string().nonempty() }),
]);

export const hasPermissionRoute = createRoute({
  method: "post",
  path: "/has-permission",
  hide: true,
  request: {
    body: jsonBody(
      z.object({ organizationId: z.string().optional() }).and(
        // `permission` is the deprecated spelling: accepted, never granted.
        z.xor([
          z.object({ permission: permissionMap }),
          z.object({ permissions: permissionMap }),
        ]),
      ),
    ),
  },
  responses: { 200: jsonResponse("Whether the caller may", anyJson) },
});

export const createRoleRoute = createRoute({
  method: "post",
  path: "/create-role",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        organizationId: z.string().optional(),
        role: z.string(),
        permission: permissionMap,
        additionalFields: z.object({}).optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The new role", anyJson) },
});

export const updateRoleRoute = createRoute({
  method: "post",
  path: "/update-role",
  hide: true,
  request: {
    body: jsonBody(
      z
        .object({
          organizationId: z.string().optional(),
          data: z.object({
            permission: permissionMap.optional(),
            roleName: z.string().optional(),
          }),
        })
        .and(roleSelector),
    ),
  },
  responses: { 200: jsonResponse("The updated role", anyJson) },
});

export const deleteRoleRoute = createRoute({
  method: "post",
  path: "/delete-role",
  hide: true,
  request: {
    body: jsonBody(
      z.object({ organizationId: z.string().optional() }).and(roleSelector),
    ),
  },
  responses: { 200: jsonResponse("The role was deleted", anyJson) },
});

export const listRolesRoute = createRoute({
  method: "get",
  path: "/list-roles",
  hide: true,
  request: { query: z.object({ organizationId: z.string().optional() }) },
  responses: { 200: jsonResponse("The workspace's stored roles", anyJson) },
});

export const getRoleRoute = createRoute({
  method: "get",
  path: "/get-role",
  hide: true,
  request: {
    // Same rule as `roleSelector`; a query schema has to stay an object.
    query: z
      .object({
        organizationId: z.string().optional(),
        roleName: z.string().nonempty().optional(),
        roleId: z.string().nonempty().optional(),
      })
      .refine((query) => query.roleName || query.roleId, {
        message: "Provide roleName or roleId",
      }),
  },
  responses: { 200: jsonResponse("The role", anyJson) },
});
