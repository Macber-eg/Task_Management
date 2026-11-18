import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

export const deviceCodeRoute = createRoute({
  method: "post",
  path: "/device/code",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        client_id: z.string(),
        user_id: z.string().optional(),
        scope: z.string().optional(),
      }),
    ),
  },
  responses: { 200: jsonResponse("Device and user codes", anyJson) },
});

export const deviceTokenRoute = createRoute({
  method: "post",
  path: "/device/token",
  hide: true,
  request: {
    body: jsonBody(
      z.object({
        grant_type: z.literal("urn:ietf:params:oauth:grant-type:device_code"),
        device_code: z.string(),
        client_id: z.string(),
      }),
    ),
  },
  responses: { 200: jsonResponse("The access token", anyJson) },
});

export const deviceVerifyRoute = createRoute({
  method: "get",
  operationId: "getDeviceAuthorizationPage",
  path: "/device",
  tags: ["Authentication"],
  summary: "Device authorization page",
  description:
    "Better Auth serves this as JSON. A top-level browser navigation is redirected to the web app's device screen instead, so opening the URL by hand shows a page rather than a JSON blob.",
  security: [],
  request: {
    query: z.object({
      user_code: z.string().optional().openapi({
        description: "The device authorization user code.",
      }),
      ui: z.enum(["1"]).optional().openapi({
        description:
          "Force a redirect to the web UI, for clients that do not send Sec-Fetch-* headers.",
      }),
    }),
  },
  responses: {
    302: { description: "Redirects the browser to the web app device screen" },
    200: { description: "Device authorization payload from Better Auth" },
    429: { $ref: "#/components/responses/ApiKeyRateLimited" },
  },
});

const userCodeBody = jsonBody(z.object({ userCode: z.string() }));

export const deviceApproveRoute = createRoute({
  method: "post",
  path: "/device/approve",
  hide: true,
  request: { body: userCodeBody },
  responses: { 200: jsonResponse("Approved", anyJson) },
});

export const deviceDenyRoute = createRoute({
  method: "post",
  path: "/device/deny",
  hide: true,
  request: { body: userCodeBody },
  responses: { 200: jsonResponse("Denied", anyJson) },
});
