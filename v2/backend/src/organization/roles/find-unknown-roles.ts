import type { EntityManager } from "typeorm";

// Names the previous library always accepted, whether or not the workspace
// stores a row for them.
const STATIC_ROLE_NAMES = new Set(["admin", "member", "owner"]);

/** The role names that are neither built in nor stored for the workspace. */
export async function findUnknownRoles(
  manager: EntityManager,
  workspaceId: string,
  roles: readonly string[],
): Promise<string[]> {
  const unknown = roles.filter((role) => !STATIC_ROLE_NAMES.has(role));
  if (unknown.length === 0) return [];
  const stored = (await manager.query(
    `SELECT role FROM workspace_role
     WHERE workspace_id = $1 AND role = ANY($2::text[])`,
    [workspaceId, unknown],
  )) as { role: string }[];
  const found = new Set(stored.map((row) => row.role));
  return unknown.filter((role) => !found.has(role));
}
