import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import { MAX_AVATAR_BYTES } from "./avatar";
import {
  avatarDeletedSchema,
  avatarSchema,
  currentUserSchema,
} from "./response";
import { avatarParam, uploadAvatarBody } from "./schema";

export const getUserAvatarRoute = createRoute({
  method: "get",
  operationId: "getUserAvatar",
  path: "/avatar/{id}",
  tags: ["User"],
  summary: "Download avatar",
  description:
    "Download a user avatar by its avatar ID. Public, immutable, and cache-friendly: the id changes whenever the avatar is replaced.",
  security: [],
  request: { params: avatarParam },
  responses: {
    200: {
      description: "The avatar image",
      content: {
        "image/*": { schema: { type: "string", format: "binary" } },
      },
    },
    304: { description: "Not modified" },
    404: errorResponse("Avatar not found"),
  },
});

export const getCurrentUserRoute = createRoute({
  method: "get",
  operationId: "getCurrentUser",
  path: "/me",
  tags: ["User"],
  summary: "Get current user",
  description: "Return the currently authenticated user.",
  responses: {
    200: jsonResponse("Current user", currentUserSchema),
    401: errorResponse("Unauthorized"),
    404: errorResponse("User not found"),
  },
});

export const uploadAvatarRoute = createRoute({
  method: "put",
  operationId: "uploadUserAvatar",
  path: "/avatar",
  tags: ["User"],
  summary: "Upload avatar",
  description: `Store a base64 encoded avatar (PNG, JPEG, or WebP, up to ${Math.floor(
    MAX_AVATAR_BYTES / 1024,
  )}KB) for the current user and return its public URL. Replaces any existing avatar.`,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: uploadAvatarBody } },
    },
  },
  responses: {
    200: jsonResponse("Avatar stored", avatarSchema),
    408: errorResponse("Request body timed out"),
    413: errorResponse("Request body exceeds the upload limit"),
    400: errorResponse(
      "Unsupported content type, malformed base64, or too large",
    ),
  },
});

export const deleteAvatarRoute = createRoute({
  method: "delete",
  operationId: "deleteUserAvatar",
  path: "/avatar",
  tags: ["User"],
  summary: "Delete avatar",
  description:
    "Remove the uploaded avatar of the current user. Succeeds even when there was nothing to remove.",
  responses: {
    200: jsonResponse("Avatar removed", avatarDeletedSchema),
  },
});
