import { createRoute, jsonResponse, z } from "../../common/openapi";

export const signInAnonymousRoute = createRoute({
  method: "post",
  path: "/sign-in/anonymous",
  hide: true,
  responses: { 200: jsonResponse("The guest user and access token", z.unknown()) },
});
