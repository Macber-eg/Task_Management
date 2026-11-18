import {
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../common/openapi";
import { descriptionPageSchema } from "../response";
import { descriptionPageQuery } from "../schema";

export const getPublicProjectDescriptionPageRoute = createRoute({
  method: "get",
  operationId: "getPublicProjectDescriptionPage",
  path: "/{id}/description",
  tags: ["Projects"],
  summary: "Read a public project description page",
  security: [],
  validationMessage: "Invalid description cursor",
  request: {
    params: z.object({ id: z.string() }),
    query: descriptionPageQuery,
  },
  responses: {
    200: jsonResponse("Public project description page", descriptionPageSchema),
    400: errorResponse("Invalid description cursor"),
    404: errorResponse("Public project not found"),
    409: errorResponse("Description changed or no longer public"),
    503: errorResponse("Description request timed out"),
  },
});

export const getPublicTaskDescriptionPageRoute = createRoute({
  method: "get",
  operationId: "getPublicTaskDescriptionPage",
  path: "/{id}/task/{taskId}/description",
  tags: ["Projects"],
  summary: "Read a public task description page",
  security: [],
  validationMessage: "Invalid description cursor",
  request: {
    params: z.object({ id: z.string(), taskId: z.string() }),
    query: descriptionPageQuery,
  },
  responses: {
    200: jsonResponse("Public task description page", descriptionPageSchema),
    400: errorResponse("Invalid description cursor"),
    404: errorResponse("Public task not found"),
    409: errorResponse("Description changed or no longer public"),
    503: errorResponse("Description request timed out"),
  },
});
