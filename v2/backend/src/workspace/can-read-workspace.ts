import { instanceAdminRoleSql } from "../access/instance-admin-role";
import {
  rolesAllow,
  type StoredRolePermission,
} from "../access/role-permissions";
import { splitRoles } from "../access/split-roles";

/** Select list for a `workspace_member` row aliased `m` and a `user` row aliased `u`. */
export const WORKSPACE_ACCESS_COLUMNS_SQL = `m.role AS role,
  coalesce(${instanceAdminRoleSql("u.role")}, false) AS "instanceAdmin"`;

export type WorkspaceAccess = {
  role: string | null;
  instanceAdmin: boolean;
};

export function canReadWorkspace(
  access: WorkspaceAccess,
  storedRoles: readonly StoredRolePermission[],
) {
  if (access.instanceAdmin) return true;
  return rolesAllow(splitRoles(access.role), storedRoles, {
    workspace: ["read"],
  });
}
