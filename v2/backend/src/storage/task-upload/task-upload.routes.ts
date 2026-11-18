import {
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../common/openapi";
import {
  fileOnlyUploadForm,
  taskImageAssetSchema,
  taskImageUploadForm,
} from "../upload/upload-schemas";

export const createTaskImageUploadRoute = createRoute({
  method: "post",
  operationId: "createTaskImageUpload",
  path: "/image-upload/{id}",
  tags: ["Tasks"],
  summary: "Upload task image",
  description:
    "Upload an image or attachment used in a task description or comment, as multipart/form-data. Stores it as a private asset and returns the URL to reference it by.",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      required: true,
      content: { "multipart/form-data": { schema: taskImageUploadForm } },
    },
  },
  responses: {
    200: jsonResponse("The stored asset", taskImageAssetSchema),
    400: errorResponse(
      "Missing file, empty file or content type, invalid surface, or image content that does not match its type",
    ),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
    413: errorResponse("The file is too large"),
    415: errorResponse("The body is not multipart/form-data"),
    503: errorResponse(
      "Image uploads are not configured on this instance, or storage is unavailable",
    ),
  },
});

export const stageTaskAssetUploadRoute = createRoute({
  method: "post",
  operationId: "stageTaskAssetUpload",
  path: "/draft-upload/{projectId}",
  tags: ["Tasks"],
  summary: "Stage a task attachment",
  description:
    "Upload an attachment before submitting a task, as multipart/form-data. Staged assets are private to the uploader and expire after 24 hours.",
  request: {
    params: z.object({ projectId: z.string() }),
    body: {
      required: true,
      content: { "multipart/form-data": { schema: fileOnlyUploadForm } },
    },
  },
  responses: {
    200: jsonResponse("Staged attachment", taskImageAssetSchema),
    400: errorResponse("Invalid upload"),
    403: errorResponse("Missing task:create permission"),
    404: errorResponse("Project not found"),
    413: errorResponse("The file is too large"),
    415: errorResponse("The body is not multipart/form-data"),
    503: errorResponse("Storage unavailable"),
  },
});
