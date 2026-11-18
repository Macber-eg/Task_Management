import type { EntityManager } from "typeorm";
import { hasInstanceAdminRole } from "../access/instance-admin-role";
import { getMemberProjectAccess } from "./get-member-project-access";
import { isOwnerRole } from "./is-owner-role";

type RoleRow = { memberRole: string | null; userRole: string | null };

/** Owners and instance admins see every project even with a stored limit. */
export async function isProjectAccessRestricted(
  manager: EntityManager,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const access = await getMemberProjectAccess(manager, workspaceId, userId);
  if (access.projectAccess === "all") return false;

  const [row] = (await manager.query(
    `SELECT m.role AS "memberRole", u.role AS "userRole"
     FROM "user" u
     LEFT JOIN workspace_member m
       ON m.user_id = u.id AND m.workspace_id = $1
     WHERE u.id = $2
     LIMIT 1`,
    [workspaceId, userId],
  )) as RoleRow[];

  return !isOwnerRole(row?.memberRole) && !hasInstanceAdminRole(row?.userRole);
}
