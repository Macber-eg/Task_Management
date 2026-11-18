import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const idTokenSchema = z.object({
  token: z.string(),
  nonce: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scopes: z.array(z.string()).optional(),
  user: z.unknown().optional(),
});

export const signInSocialRoute = createRoute({
  method: "post",
  path: "/sign-in/social",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        provider: z.string(),
        callbackURL: z.string().optional(),
        newUserCallbackURL: z.string().optional(),
        errorCallbackURL: z.string().optional(),
        disableRedirect: z.boolean().optional(),
        idToken: idTokenSchema.optional(),
        scopes: z.array(z.string()).optional(),
        requestSignUp: z.boolean().optional(),
        loginHint: z.string().optional(),
        additionalData: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The provider's authorization URL", anyJson) },
});

export const linkSocialRoute = createRoute({
  method: "post",
  path: "/link-social",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        provider: z.string(),
        callbackURL: z.string().optional(),
        errorCallbackURL: z.string().optional(),
        disableRedirect: z.boolean().optional(),
        idToken: idTokenSchema.optional(),
        scopes: z.array(z.string()).optional(),
        requestSignUp: z.boolean().optional(),
        additionalData: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The provider's authorization URL", anyJson) },
});

// The query is checked by the handler: a malformed callback redirects to the
// error page instead of answering JSON.
export const socialCallbackRoute = createRoute({
  method: "get",
  path: "/callback/{id}",
  hide: true,
  request: { params: z.object({ id: z.string() }) },
  responses: { 302: { description: "Back to the web app" } },
});

export const oauthErrorRoute = createRoute({
  method: "get",
  path: "/error",
  hide: true,
  responses: { 200: { description: "The error page" } },
});

export const socialCallbackPostRoute = createRoute({
  method: "post",
  path: "/callback/{id}",
  hide: true,
  request: { params: z.object({ id: z.string() }) },
  responses: { 302: { description: "Redirects to the GET callback" } },
});
