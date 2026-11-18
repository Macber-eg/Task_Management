import { createRoute, errorResponse, jsonResponse } from "../common/openapi";
import {
  checkoutSchema,
  portalSchema,
  webhookResultSchema,
  workspaceBillingSchema,
} from "./response";
import { createCheckoutBody, workspaceIdParam } from "./schema";

// Kaneo Cloud only: still served, but kept out of the published document so the
// self-hosted API reference does not advertise a paid tier that does not exist.
const cloudOnly = { hide: true } as const;

export const webhookRoute = createRoute({
  ...cloudOnly,
  method: "post",
  operationId: "handleBillingWebhook",
  path: "/webhook",
  tags: ["Billing"],
  summary: "Billing webhook",
  description:
    "Receive a Creem subscription event. Authenticated by signature, not by session, and idempotent per event id.",
  security: [],
  responses: {
    200: jsonResponse("The event was accepted", webhookResultSchema),
    400: errorResponse("Signature verification failed"),
    404: errorResponse("Billing is not enabled on this instance"),
  },
});

export const getWorkspaceBillingRoute = createRoute({
  ...cloudOnly,
  method: "get",
  operationId: "getWorkspaceBilling",
  path: "/{workspaceId}",
  tags: ["Billing"],
  summary: "Get workspace billing",
  description:
    "Get the billing state and entitlement for a workspace. When the instance has no billing configured this reports billingEnabled: false and an always-active entitlement.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "Billing state for the workspace",
      workspaceBillingSchema,
    ),
    404: errorResponse("Workspace not found"),
  },
});

export const createCheckoutRoute = createRoute({
  ...cloudOnly,
  method: "post",
  operationId: "createBillingCheckout",
  path: "/{workspaceId}/checkout",
  tags: ["Billing"],
  summary: "Create checkout",
  description:
    "Create a Creem checkout session for a workspace plan and return the URL to redirect the browser to. Workspace owners and admins only.",
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createCheckoutBody } },
    },
  },
  responses: {
    200: jsonResponse("The checkout session", checkoutSchema),
    400: errorResponse("Invalid plan or interval"),
    403: errorResponse("Not a workspace owner or admin"),
    404: errorResponse("Workspace not found"),
  },
});

export const createPortalRoute = createRoute({
  ...cloudOnly,
  method: "post",
  operationId: "createBillingPortalSession",
  path: "/{workspaceId}/portal",
  tags: ["Billing"],
  summary: "Create portal session",
  description:
    "Generate a Creem customer portal link for the workspace subscription. Workspace owners and admins only, and only once a billing customer exists.",
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The portal link", portalSchema),
    400: errorResponse("No billing customer exists for this workspace yet"),
    403: errorResponse("Not a workspace owner or admin"),
    404: errorResponse("Workspace not found"),
  },
});
