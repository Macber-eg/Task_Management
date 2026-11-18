import type { EntityManager } from "typeorm";

type InvitationRow = {
  id: string;
  email: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: Date;
  status: string;
};

export type InvitationDetails = InvitationRow & { expired: boolean };

export type InvitationDetailsResult = {
  valid: boolean;
  invitation?: InvitationDetails;
  error?: string;
};

/**
 * What an invitation link shows before sign-up. Details of a missing,
 * accepted or canceled invitation are withheld rather than leaked.
 */
export async function getInvitationDetails(
  manager: EntityManager,
  invitationId: string,
): Promise<InvitationDetailsResult> {
  const now = new Date();

  const [row] = (await manager.query(
    `SELECT i.id, i.email, w.name AS "workspaceName", u.name AS "inviterName",
            i.expires_at AS "expiresAt", i.status
     FROM invitation i
     INNER JOIN workspace w ON i.workspace_id = w.id
     INNER JOIN "user" u ON i.inviter_id = u.id
     WHERE i.id = $1
     LIMIT 1`,
    [invitationId],
  )) as InvitationRow[];

  if (!row) {
    return {
      valid: false,
      error: "Invitation not found",
    };
  }

  const expired = row.expiresAt < now;

  if (row.status === "accepted") {
    return {
      valid: false,
      error: "This invitation has already been accepted",
    };
  }

  if (row.status === "canceled") {
    return {
      valid: false,
      error: "This invitation has been canceled",
    };
  }

  const invitation: InvitationDetails = {
    id: row.id,
    email: row.email,
    workspaceName: row.workspaceName,
    inviterName: row.inviterName,
    expiresAt: row.expiresAt,
    status: row.status,
    expired,
  };

  if (expired) {
    return {
      valid: false,
      invitation,
      error: "This invitation has expired",
    };
  }

  return {
    valid: true,
    invitation,
  };
}
