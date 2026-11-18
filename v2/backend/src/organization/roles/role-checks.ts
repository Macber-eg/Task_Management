import type { EntityManager } from "typeorm";
import { statement } from "../../permissions";
import { organizationError } from "../organization-error";
import {
  CREATOR_ROLE,
  type PermissionRequest,
  rolesAuthorize,
  type Statements,
} from "./role-authorization";

/** Role names compared and stored in lower case. */
export function normalizeRoleName(role: string): string {
  return role.toLowerCase();
}

/** `owner` is defined in code and can be neither created nor renamed to. */
export async function assertRoleNameFree(
  manager: EntityManager,
  workspaceId: string,
  role: string,
): Promise<void> {
  if (role === CREATOR_ROLE) {
    throw organizationError(400, "ROLE_NAME_IS_ALREADY_TAKEN");
  }
  const taken = (await manager.query(
    "SELECT 1 FROM workspace_role WHERE workspace_id = $1 AND role = $2 LIMIT 1",
    [workspaceId, role],
  )) as unknown[];
  if (taken.length > 0) {
    throw organizationError(400, "ROLE_NAME_IS_ALREADY_TAKEN");
  }
}

export function assertKnownResources(permission: PermissionRequest): void {
  const known = Object.keys(statement);
  if (Object.keys(permission).some((resource) => !known.includes(resource))) {
    throw organizationError(400, "INVALID_RESOURCE");
  }
}

/**
 * The actions in `permission` the member could not perform themselves, as
 * `resource:action`. Nobody can hand a role more than they hold.
 */
export function ungrantablePermissions(
  roles: ReadonlyMap<string, Statements>,
  memberRole: string,
  permission: PermissionRequest,
): string[] {
  return Object.entries(permission).flatMap(([resource, actions]) =>
    actions
      .filter(
        (action) => !rolesAuthorize(roles, memberRole, { [resource]: [action] }),
      )
      .map((action) => `${resource}:${action}`),
  );
}
