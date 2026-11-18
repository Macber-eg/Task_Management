import type { EntityManager } from "typeorm";

type ValidInvitation = {
  id: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: Date;
  status: string;
};

export type RegistrationCheckResult = {
  allowed: boolean;
  reason: string;
  invitation?: ValidInvitation;
};

async function findValidInvitation(
  manager: EntityManager,
  email?: string,
  invitationId?: string,
): Promise<ValidInvitation | null> {
  if (!invitationId && !email) {
    return null;
  }

  const conditions = ["i.status = 'pending'", "i.expires_at > $1"];
  const parameters: unknown[] = [new Date()];

  if (invitationId) {
    parameters.push(invitationId);
    conditions.push(`i.id = $${parameters.length}`);
  }

  if (email) {
    parameters.push(email.toLowerCase());
    conditions.push(`i.email = $${parameters.length}`);
  }

  const [row] = (await manager.query(
    `SELECT i.id, i.email, i.workspace_id AS "workspaceId",
            w.name AS "workspaceName", u.name AS "inviterName",
            i.expires_at AS "expiresAt", i.status
     FROM invitation i
     INNER JOIN workspace w ON i.workspace_id = w.id
     INNER JOIN "user" u ON i.inviter_id = u.id
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    parameters,
  )) as ValidInvitation[];

  return row ?? null;
}

/**
 * With registration disabled, a new account needs a pending invitation: the
 * one named by `invitationId`, or one for an email address the sign-in flow
 * has verified.
 */
export async function checkRegistrationAllowed(
  manager: EntityManager,
  email?: string,
  invitationId?: string,
  options?: { allowInvitationByEmail?: boolean; emailVerified?: boolean },
): Promise<RegistrationCheckResult> {
  const isRegistrationDisabled = process.env.DISABLE_REGISTRATION === "true";

  if (!isRegistrationDisabled) {
    return {
      allowed: true,
      reason: "Registration is enabled",
    };
  }

  const canMatchByEmail = Boolean(
    options?.allowInvitationByEmail && options.emailVerified === true && email,
  );

  if (!invitationId && !canMatchByEmail) {
    return {
      allowed: false,
      reason:
        "Registration is currently disabled. Please use a valid invitation link to create an account.",
    };
  }

  const invitation = await findValidInvitation(manager, email, invitationId);

  if (!invitation) {
    return {
      allowed: false,
      reason:
        "Registration is currently disabled. You need a valid invitation to create an account.",
    };
  }

  return {
    allowed: true,
    reason: "Valid invitation found",
    invitation,
  };
}
