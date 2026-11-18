import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

export const signUpEmailRoute = createRoute({
  method: "post",
  path: "/sign-up/email",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        name: z.string(),
        email: z.string(),
        password: z.string(),
        image: z.string().nullish(),
        locale: z.string().nullish(),
        callbackURL: z.string().optional(),
        rememberMe: z.boolean().optional(),
        invitationId: z.string().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The new user and access token", anyJson) },
});

export const signInEmailRoute = createRoute({
  method: "post",
  path: "/sign-in/email",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        email: z.string(),
        password: z.string(),
        callbackURL: z.string().optional(),
        rememberMe: z.boolean().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The user and access token", anyJson) },
});
