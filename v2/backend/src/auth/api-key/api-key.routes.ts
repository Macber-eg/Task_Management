import { createRoute, jsonResponse, z } from "../../common/openapi";
import {
  createApiKeyBody,
  deleteApiKeyBody,
  getApiKeyQuery,
  listApiKeysQuery,
  updateApiKeyBody,
} from "./schema";

// Hidden like the other /auth routes: the previous backend's API document
// did not describe them either.
const anyJson = z.unknown();

export const createApiKeyRoute = createRoute({
  method: "post",
  path: "/create",
  hide: true,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createApiKeyBody } },
    },
  },
  responses: {
    200: jsonResponse("The new key, including its one-time secret", anyJson),
  },
});

export const listApiKeysRoute = createRoute({
  method: "get",
  path: "/list",
  hide: true,
  request: { query: listApiKeysQuery },
  responses: { 200: jsonResponse("The caller's API keys", anyJson) },
});

export const deleteApiKeyRoute = createRoute({
  method: "post",
  path: "/delete",
  hide: true,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: deleteApiKeyBody } },
    },
  },
  responses: { 200: jsonResponse("The key was deleted", anyJson) },
});

export const getApiKeyRoute = createRoute({
  method: "get",
  path: "/get",
  hide: true,
  request: { query: getApiKeyQuery },
  responses: { 200: jsonResponse("One of the caller's API keys", anyJson) },
});

export const updateApiKeyRoute = createRoute({
  method: "post",
  path: "/update",
  hide: true,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updateApiKeyBody } },
    },
  },
  responses: { 200: jsonResponse("The updated key", anyJson) },
});
