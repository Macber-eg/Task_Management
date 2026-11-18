import { createRoute, jsonResponse, z } from "../../common/openapi";

const anyJson = z.unknown();

export const getSessionRoute = createRoute({
  method: "get",
  path: "/get-session",
  hide: true,
  request: {
    query: z.object({
      disableRefresh: z.enum(["true", "false"]).optional(),
      disableCookieCache: z.string().optional(),
    }),
  },
  responses: { 200: jsonResponse("The current session, or null", anyJson) },
});

export const refreshRoute = createRoute({
  method: "post",
  path: "/refresh",
  hide: true,
  responses: { 200: jsonResponse("New access token", anyJson) },
});

export const signOutRoute = createRoute({
  method: "post",
  path: "/sign-out",
  hide: true,
  responses: { 200: jsonResponse("Signed out", anyJson) },
});
