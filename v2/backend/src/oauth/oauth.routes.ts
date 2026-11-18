import { createRoute, jsonResponse } from "../common/openapi";
import { idTokenSchema } from "./response";

export const getIdTokenRoute = createRoute({
  method: "get",
  operationId: "getOAuthIdToken",
  path: "/id-token",
  tags: ["Authentication"],
  summary: "Get OAuth id token",
  description:
    "Get the id_token for the current user's custom OAuth account. Returns null when the user signed in another way.",
  responses: {
    200: jsonResponse("The id_token if available", idTokenSchema),
  },
});
