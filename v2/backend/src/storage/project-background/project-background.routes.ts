import {
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../common/openapi";
import { fileOnlyUploadForm, projectBackgroundSchema } from "../upload/upload-schemas";

const projectParam = z.object({ id: z.string() });

export const getProjectBackgroundRoute = createRoute({
  method: "get",
  operationId: "getProjectBackground",
  path: "/{id}/background",
  tags: ["Projects"],
  summary: "Download project background",
  description: "Download the current project board background image.",
  request: { params: projectParam },
  responses: {
    200: {
      description: "The project background image",
      content: {
        "image/*": { schema: { type: "string", format: "binary" } },
      },
    },
    304: { description: "Not modified" },
    403: errorResponse("No access to the project"),
    404: errorResponse("Project or project background not found"),
  },
});

export const uploadProjectBackgroundRoute = createRoute({
  method: "post",
  operationId: "uploadProjectBackground",
  path: "/{id}/background-upload",
  tags: ["Projects"],
  summary: "Upload project background",
  description:
    "Upload a board background image for a project, as multipart/form-data, and make it the project's background.",
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "multipart/form-data": { schema: fileOnlyUploadForm } },
    },
  },
  responses: {
    200: jsonResponse("The new project background", projectBackgroundSchema),
    400: errorResponse("Invalid image upload request"),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
    413: errorResponse("The image is too large"),
    415: errorResponse("The body is not multipart/form-data"),
    503: errorResponse(
      "Image uploads are not configured, or storage is unavailable",
    ),
  },
});

export const deleteProjectBackgroundRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectBackground",
  path: "/{id}/background",
  tags: ["Projects"],
  summary: "Delete project background",
  description: "Remove the current project board background image.",
  request: { params: projectParam },
  responses: {
    204: { description: "Project background removed" },
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});
