import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

export const signInMagicLinkRoute = createRoute({
  method: "post",
  path: "/sign-in/magic-link",
  hide: true,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            email: z.email(),
            name: z.string().optional(),
            callbackURL: z.string().optional(),
            newUserCallbackURL: z.string().optional(),
            errorCallbackURL: z.string().optional(),
            metadata: z.record(z.string(), z.any()).optional(),
          }),
        },
      },
    },
  },
  responses: { 200: jsonResponse("Link sent", anyJson) },
});

export const verifyMagicLinkRoute = createRoute({
  method: "get",
  path: "/magic-link/verify",
  hide: true,
  request: {
    query: z.object({
      token: z.string(),
      callbackURL: z.string().optional(),
      errorCallbackURL: z.string().optional(),
      newUserCallbackURL: z.string().optional(),
    }),
  },
  responses: {
    200: jsonResponse("The session, without a callback URL", anyJson),
    302: { description: "Redirect to the callback URL" },
  },
});
