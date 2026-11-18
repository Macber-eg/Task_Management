import { createRoute, jsonResponse } from "../common/openapi";
import { instanceStatusSchema } from "./response";

export const getInstanceStatusRoute = createRoute({
  method: "get",
  operationId: "getInstanceStatus",
  path: "/status",
  tags: ["Instance"],
  summary: "Get instance status",
  description:
    "Public instance setup status. When hasUsers is false the next signup becomes the instance admin.",
  security: [],
  responses: {
    200: jsonResponse("Instance status", instanceStatusSchema),
  },
});
