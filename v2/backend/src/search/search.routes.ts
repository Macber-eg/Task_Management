import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import { searchResponseSchema } from "./response";
import { searchQuery } from "./schema";

export const globalSearchRoute = createRoute({
  method: "get",
  operationId: "globalSearch",
  path: "/",
  tags: ["Search"],
  summary: "Global search",
  description:
    "Search across tasks, projects, workspaces, comments, and activities in one workspace. Results are ranked by relevance and returned as a single flat list, each entry tagged with its `type`.",
  request: { query: searchQuery },
  responses: {
    200: jsonResponse("Ranked search results", searchResponseSchema),
    400: errorResponse(
      "Invalid query, or workspace ID could not be determined",
    ),
    404: errorResponse("Workspace not found"),
  },
});
