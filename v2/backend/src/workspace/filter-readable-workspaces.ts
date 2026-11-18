import type { EntityManager } from "typeorm";
import type { StoredRolePermission } from "../access/role-permissions";
import { splitRoles } from "../access/split-roles";
import { canReadWorkspace, type WorkspaceAccess } from "./can-read-workspace";

type StoredWorkspaceRole = StoredRolePermission & { workspaceId: string };

async function loadStoredRoles(
  manager: EntityManager,
  rows: (WorkspaceAccess & { id: string })[],
) {
  const pending = rows.filter((row) => !row.instanceAdmin);
  const workspaceIds = [...new Set(pending.map((row) => row.id))];
  const roles = [...new Set(pending.flatMap((row) => splitRoles(row.role)))];
  const byWorkspace = new Map<string, StoredRolePermission[]>();
  if (workspaceIds.length === 0 || roles.length === 0) return byWorkspace;

  const stored = (await manager.query(
    `SELECT workspace_id AS "workspaceId", role, permission
     FROM workspace_role
     WHERE workspace_id = ANY($1::text[]) AND role = ANY($2::text[])`,
    [workspaceIds, roles],
  )) as StoredWorkspaceRole[];

  for (const { workspaceId, ...role } of stored) {
    const list = byWorkspace.get(workspaceId) ?? [];
    list.push(role);
    byWorkspace.set(workspaceId, list);
  }
  return byWorkspace;
}

export async function filterReadableWorkspaces<
  T extends WorkspaceAccess & { id: string },
>(manager: EntityManager, rows: T[]): Promise<T[]> {
  const storedRoles = await loadStoredRoles(manager, rows);
  return rows.filter((row) =>
    canReadWorkspace(row, storedRoles.get(row.id) ?? []),
  );
}
