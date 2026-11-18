import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

export const requestPasswordResetRoute = createRoute({
  method: "post",
  path: "/request-password-reset",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        email: z.email(),
        redirectTo: z.string().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("Reset email requested", anyJson) },
});

export const resetPasswordCallbackRoute = createRoute({
  method: "get",
  path: "/reset-password/{token}",
  hide: true,
  request: {
    params: z.object({ token: z.string() }),
    query: z.object({ callbackURL: z.string() }),
  },
  responses: { 302: { description: "Redirect to the reset form" } },
});

export const resetPasswordRoute = createRoute({
  method: "post",
  path: "/reset-password",
  hide: true,
  request: {
    query: z.object({ token: z.string().optional() }),
    body: jsonBody(
      z.object({
        newPassword: z.string(),
        token: z.string().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("Password changed", anyJson) },
});
