import type { EntityManager } from "typeorm";
import { CREATOR_ROLE } from "../roles/role-authorization";

export function hasOwnerRole(role: string): boolean {
  return role.split(",").includes(CREATOR_ROLE);
}

/** How many members of the workspace hold the owner role. */
export async function countOwners(
  manager: EntityManager,
  workspaceId: string,
): Promise<number> {
  const [row] = (await manager.query(
    `SELECT count(*)::int AS count FROM workspace_member
     WHERE workspace_id = $1 AND $2 = ANY(string_to_array(role, ','))`,
    [workspaceId, CREATOR_ROLE],
  )) as { count: number }[];
  return row?.count ?? 0;
}
