import type { EntityManager } from "typeorm";
import { DEFAULT_ROLE_NAMES } from "../../permissions";

/** A single built-in or custom role other than `owner`. */
export async function isAssignableWorkspaceRole(
  manager: EntityManager,
  workspaceId: string,
  role: string,
): Promise<boolean> {
  if (role.includes(",") || role === "owner") return false;
  if ((DEFAULT_ROLE_NAMES as readonly string[]).includes(role)) return true;

  const custom = (await manager.query(
    "SELECT id FROM workspace_role WHERE workspace_id = $1 AND role = $2 LIMIT 1",
    [workspaceId, role],
  )) as unknown[];
  return custom.length > 0;
}
