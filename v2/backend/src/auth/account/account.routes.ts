import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

export const updateUserRoute = createRoute({
  method: "post",
  path: "/update-user",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        name: z.string().optional(),
        image: z.string().nullish(),
        locale: z.string().nullish(),
        email: z.unknown().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("Profile updated", anyJson) },
});

export const changePasswordRoute = createRoute({
  method: "post",
  path: "/change-password",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string(),
        revokeOtherSessions: z.boolean().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("Password changed", anyJson) },
});

export const listAccountsRoute = createRoute({
  method: "get",
  path: "/list-accounts",
  hide: true,
  responses: { 200: jsonResponse("Linked sign-in methods", anyJson) },
});
