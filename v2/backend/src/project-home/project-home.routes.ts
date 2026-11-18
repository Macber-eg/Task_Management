import { createRoute, jsonResponse, z } from "../common/openapi";
import {
  bookmarkBody,
  bookmarkIdParam,
  looseRecord,
  projectIdParam,
  recentBody,
} from "./schema";

export const listProjectBookmarksRoute = createRoute({
  method: "get",
  operationId: "listProjectBookmarks",
  path: "/bookmarks/{projectId}",
  tags: ["Project Home"],
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Bookmarks", z.array(looseRecord)),
  },
});

export const createProjectBookmarkRoute = createRoute({
  method: "post",
  operationId: "createProjectBookmark",
  path: "/bookmarks/{projectId}",
  tags: ["Project Home"],
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: bookmarkBody } },
    },
  },
  responses: {
    200: jsonResponse("Bookmark", looseRecord),
  },
});

export const updateProjectBookmarkRoute = createRoute({
  method: "put",
  operationId: "updateProjectBookmark",
  path: "/bookmark/{id}",
  tags: ["Project Home"],
  request: {
    params: bookmarkIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: bookmarkBody } },
    },
  },
  responses: {
    200: jsonResponse("Bookmark", looseRecord),
  },
});

export const deleteProjectBookmarkRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectBookmark",
  path: "/bookmark/{id}",
  tags: ["Project Home"],
  request: { params: bookmarkIdParam },
  responses: {
    200: jsonResponse("Bookmark", looseRecord),
  },
});

export const listProjectRecentRoute = createRoute({
  method: "get",
  operationId: "listProjectRecent",
  path: "/recent/{projectId}",
  tags: ["Project Home"],
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Recent", z.array(looseRecord)),
  },
});

export const recordProjectRecentRoute = createRoute({
  method: "post",
  operationId: "recordProjectRecent",
  path: "/recent/{projectId}",
  tags: ["Project Home"],
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: recentBody } },
    },
  },
  responses: {
    200: jsonResponse("Recent", z.array(looseRecord)),
  },
});

export const listProjectHomeAssetsRoute = createRoute({
  method: "get",
  operationId: "listProjectHomeAssets",
  path: "/assets/{projectId}",
  tags: ["Project Home"],
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Assets", z.array(looseRecord)),
  },
});
