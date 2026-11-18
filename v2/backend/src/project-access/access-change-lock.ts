import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { hasInstanceAdminRole } from "../access/instance-admin-role";
import { WorkspacePermissionService } from "../access/workspace-permission.service";

type MemberRole = { userId: string; role: string };

@Injectable()
export class AccessChangeLock {
  constructor(private readonly permissions: WorkspacePermissionService) {}

  /**
   * Locks the actor's and the target's membership rows for the transaction,
   * so a concurrent role change cannot slip between the permission check and
   * the write. `targetRole` is null when the target is not a member.
   */
  async lockAccessChange(
    manager: EntityManager,
    change: { workspaceId: string; actorId: string; userId: string },
  ): Promise<{ actorAllowed: boolean; targetRole: string | null }> {
    const rows = (await manager.query(
      `SELECT user_id AS "userId", role FROM workspace_member
       WHERE workspace_id = $1 AND user_id = ANY($2::text[])
       ORDER BY id
       FOR UPDATE`,
      [change.workspaceId, [change.actorId, change.userId]],
    )) as MemberRole[];
    const roles = new Map(rows.map((row) => [row.userId, row.role]));
    const actorRole = roles.get(change.actorId);
    const targetRole = roles.get(change.userId) ?? null;

    if (
      actorRole &&
      (await this.permissions.roleHasWorkspacePermission(
        change.workspaceId,
        actorRole,
        { member: ["update"] },
        manager,
      ))
    ) {
      return { actorAllowed: true, targetRole };
    }

    const [actor] = (await manager.query(
      `SELECT role FROM "user" WHERE id = $1 LIMIT 1`,
      [change.actorId],
    )) as { role: string | null }[];

    return { actorAllowed: hasInstanceAdminRole(actor?.role), targetRole };
  }
}
