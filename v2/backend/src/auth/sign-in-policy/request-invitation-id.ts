import type { Request } from "express";

/**
 * The invitation an account-creating request names, from the body, the
 * query string or the `x-invitation-id` header, in the previous backend's
 * order. Unvalidated: the registration policy normalizes it.
 */
export function requestInvitationId(request: Request): unknown {
  const body = request.body as { invitationId?: unknown } | undefined;
  const query = request.query as { invitationId?: unknown };
  return (
    body?.invitationId ||
    query.invitationId ||
    request.get("x-invitation-id")
  );
}
