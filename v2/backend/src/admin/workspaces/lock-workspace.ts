import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";

export type LockedMember = { userId: string; role: string };

/**
 * Locks the workspace row and its memberships for the transaction, so
 * owner checks and the change they guard cannot interleave.
 */
export async function lockWorkspace(
  manager: EntityManager,
  workspaceId: string,
): Promise<LockedMember[]> {
  const workspaces = (await manager.query(
    "SELECT id FROM workspace WHERE id = $1 FOR UPDATE",
    [workspaceId],
  )) as unknown[];
  if (workspaces.length === 0) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const members = (await manager.query(
    `SELECT user_id, role FROM workspace_member
     WHERE workspace_id = $1 ORDER BY id FOR UPDATE`,
    [workspaceId],
  )) as { user_id: string; role: string }[];
  return members.map((member) => ({
    userId: member.user_id,
    role: member.role,
  }));
}
