import { createRoute, jsonResponse } from "../../common/openapi";
import {
  authorizationDecisionResponseSchema,
  authorizationDecisionSchema,
  authorizationQuerySchema,
  authorizationRequestParamSchema,
  authorizationRequestResponseSchema,
  clientRegistrationResponseSchema,
  clientRegistrationSchema,
  oauthErrorSchema,
} from "./oauth.schemas";

const jsonError = (description: string) =>
  jsonResponse(description, oauthErrorSchema);

export const registerRoute = createRoute({
  method: "post",
  operationId: "registerMcpOAuthClient",
  path: "/register",
  tags: ["MCP"],
  summary: "Register MCP OAuth client",
  description:
    "Dynamically register a public OAuth client for the MCP endpoint. Public clients hold no secret, so authorization is protected by PKCE and an explicit consent step.",
  security: [],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: clientRegistrationSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Registered OAuth client",
      clientRegistrationResponseSchema,
    ),
    400: jsonError("Invalid client metadata"),
  },
});

export const authorizeRoute = createRoute({
  method: "get",
  operationId: "authorizeMcpOAuthClient",
  path: "/authorize",
  tags: ["MCP"],
  summary: "Start MCP authorization",
  description:
    "Begin an MCP OAuth authorization. Redirects the browser to the Kaneo consent page, which then approves or denies the request.",
  security: [],
  request: { query: authorizationQuerySchema },
  responses: {
    302: { description: "Redirect to the Kaneo consent page" },
    400: jsonError("Invalid authorization request"),
  },
});

export const getAuthorizationRequestRoute = createRoute({
  method: "get",
  operationId: "getMcpAuthorizationRequest",
  path: "/authorize/request/{requestId}",
  tags: ["MCP"],
  summary: "Get consent request",
  description:
    "Get the client name and redirect URI for a pending consent request, so the consent page can show who is asking.",
  security: [],
  request: { params: authorizationRequestParamSchema },
  responses: {
    200: jsonResponse(
      "Authorization request details",
      authorizationRequestResponseSchema,
    ),
    400: jsonError("Invalid OAuth client"),
    404: jsonError("Unknown or expired authorization request"),
  },
});

export const decideAuthorizationRequestRoute = createRoute({
  method: "post",
  operationId: "decideMcpAuthorizationRequest",
  path: "/authorize/request/{requestId}",
  tags: ["MCP"],
  summary: "Decide consent request",
  description:
    "Approve or deny a pending consent request and get the URL to send the browser back to.",
  request: {
    params: authorizationRequestParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: authorizationDecisionSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "OAuth client redirect",
      authorizationDecisionResponseSchema,
    ),
    400: jsonError("Invalid request or OAuth client"),
    401: jsonError("Authentication required"),
    403: jsonError("Untrusted request origin"),
    404: jsonError("Unknown or expired authorization request"),
  },
});
