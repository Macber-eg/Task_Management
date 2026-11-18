import { createRoute, errorResponse, z } from "../../common/openapi";

export const getAssetRoute = createRoute({
  method: "get",
  operationId: "getAsset",
  path: "/{id}",
  tags: ["Assets"],
  summary: "Download asset",
  description:
    "Download an uploaded asset. Readable without signing in only when it belongs to a public project; image types are served inline, everything else as an attachment.",
  security: [],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "The requested asset binary stream",
      content: { "*/*": { schema: { type: "string", format: "binary" } } },
    },
    304: { description: "Not modified" },
    403: errorResponse(
      "Staged upload owned by another user, or no access to the asset's project",
    ),
    404: errorResponse("Asset not found"),
    429: { $ref: "#/components/responses/ApiKeyRateLimited" },
  },
});
