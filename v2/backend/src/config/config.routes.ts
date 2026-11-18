import { createRoute, jsonResponse } from "../common/openapi";
import { configSchema } from "./response";

export const getConfigRoute = createRoute({
  method: "get",
  operationId: "getConfig",
  path: "/",
  tags: ["Config"],
  summary: "Get config",
  description:
    "Public instance settings: which sign-in methods, registration paths, and features are enabled.",
  security: [],
  responses: {
    200: jsonResponse("Application settings", configSchema),
  },
});
