import { createRoute, jsonResponse, z } from "../../common/openapi";

export const signInOAuth2Route = createRoute({
  method: "post",
  path: "/sign-in/oauth2",
  hide: true,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            providerId: z.string(),
            callbackURL: z.string().optional(),
            errorCallbackURL: z.string().optional(),
            newUserCallbackURL: z.string().optional(),
            disableRedirect: z.boolean().optional(),
            scopes: z.array(z.string()).optional(),
            requestSignUp: z.boolean().optional(),
            additionalData: z.record(z.string(), z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("The provider's authorization URL", z.unknown()),
  },
});

export const oauth2CallbackRoute = createRoute({
  method: "get",
  path: "/oauth2/callback/{providerId}",
  hide: true,
  request: {
    params: z.object({ providerId: z.string() }),
    query: z.object({
      code: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
      state: z.string().optional(),
      iss: z.string().optional(),
    }),
  },
  responses: { 302: { description: "Back to the web app" } },
});
