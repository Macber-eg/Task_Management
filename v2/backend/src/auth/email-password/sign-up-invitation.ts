import type { Request } from "express";

export type SignUpInvitation = {
  /** Unvalidated: the registration policy normalizes it. */
  invitationId?: unknown;
  email?: string;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Where an invitation link's details arrive on sign-up, in the previous API's
 * order: the body, then the query string, then the `x-invitation-*` headers.
 */
export function readSignUpInvitation(
  request: Request,
  body: { email?: string; invitationId?: string },
): SignUpInvitation {
  const query = request.query as Record<string, unknown>;
  return {
    invitationId:
      text(body.invitationId) ??
      text(query.invitationId) ??
      text(request.headers["x-invitation-id"]),
    email:
      text(body.email) ??
      text(query.email) ??
      text(request.headers["x-invitation-email"]),
  };
}
