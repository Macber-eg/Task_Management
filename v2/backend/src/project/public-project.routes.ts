import { createRoute, errorResponse, jsonResponse, z } from "../common/openapi";
import { boardSchema } from "./public-board/board-schema";
import { publicBoardQuery } from "./public-board/public-board-query";

export const getPublicProjectRoute = createRoute({
  method: "get",
  operationId: "getPublicProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Get a public project board",
  description:
    "Read a public board in bounded task pages. Visibility is checked before loading tasks. Continue through pagination.totalPages for all tasks and through relatedPage/pagination.relatedTotalPages for their complete related records.",
  security: [],
  validationMessage: "Invalid task pagination or filters",
  request: {
    params: z.object({ id: z.string() }),
    query: publicBoardQuery,
  },
  responses: {
    200: jsonResponse(
      "A public board page",
      boardSchema.shape.data
        .extend({ pagination: boardSchema.shape.pagination })
        .openapi("PublicBoardPage"),
    ),
    403: errorResponse("Project is not public"),
    404: errorResponse("Project not found"),
    400: errorResponse("Invalid pagination or filters"),
    503: errorResponse("Task list request timed out"),
  },
});
