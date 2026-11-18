import { createRoute, jsonResponse } from "../common/openapi";
import {
  invitationDetailsSchema,
  pendingInvitationListSchema,
} from "./response";
import { invitationParam } from "./schema";

// Undocumented, as in the previous API: the sign-up screen reads it before
// the visitor has an account.
export const getPublicInvitationRoute = createRoute({
  method: "get",
  operationId: "getPublicInvitationDetails",
  path: "/public/{id}",
  hide: true,
  request: { params: invitationParam },
  responses: {
    200: jsonResponse("Invitation details", invitationDetailsSchema),
  },
});

export const getPendingRoute = createRoute({
  method: "get",
  operationId: "getUserPendingInvitations",
  path: "/pending",
  tags: ["Invitations"],
  summary: "Get pending invitations",
  description:
    "Get the current user's unexpired, unaccepted invitations. Returns an empty list until the user's email is verified.",
  responses: {
    200: jsonResponse(
      "List of pending invitations",
      pendingInvitationListSchema,
    ),
  },
});

export const getInvitationRoute = createRoute({
  method: "get",
  operationId: "getInvitationDetails",
  path: "/{id}",
  tags: ["Invitations"],
  summary: "Get invitation details",
  description:
    "Look up an invitation by ID. Always 200 -- an unusable invitation is reported with valid: false and a reason rather than an error status.",
  request: { params: invitationParam },
  responses: {
    200: jsonResponse("Invitation details", invitationDetailsSchema),
  },
});
