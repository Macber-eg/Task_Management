import type { EntityManager } from "typeorm";

export type PendingInvitation = {
  id: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: Date;
  createdAt: Date;
  status: string;
};

/** The unexpired pending invitations for an email address, oldest first. */
export async function getUserPendingInvitations(
  manager: EntityManager,
  userEmail: string,
): Promise<PendingInvitation[]> {
  return (await manager.query(
    `SELECT i.id, i.email, i.workspace_id AS "workspaceId",
            w.name AS "workspaceName", u.name AS "inviterName",
            i.expires_at AS "expiresAt", i.created_at AS "createdAt", i.status
     FROM invitation i
     INNER JOIN workspace w ON i.workspace_id = w.id
     INNER JOIN "user" u ON i.inviter_id = u.id
     WHERE i.email = $1 AND i.status = 'pending' AND i.expires_at > $2
     ORDER BY i.created_at`,
    [userEmail.toLowerCase(), new Date()],
  )) as PendingInvitation[];
}
