import { HTTPException } from "../../common/errors/http-exception";
import { owner } from "../../permissions";

export type Statements = Record<string, readonly string[]>;
export type PermissionRequest = Record<string, readonly string[]>;
export type StoredRole = { role: string; permission: string };

export const CREATOR_ROLE = "owner";

function parseStored(row: StoredRole): Record<string, string[]> {
  const value: unknown = JSON.parse(row.permission);
  const valid =
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (actions) =>
        Array.isArray(actions) &&
        actions.every((action) => typeof action === "string"),
    );
  if (!valid) {
    throw new HTTPException(500, {
      message: `Invalid permissions for role ${row.role}`,
    });
  }
  return value as Record<string, string[]>;
}

/**
 * The statements each role grants in one workspace. `owner` is fixed in
 * code; a stored row adds to a role defined in code and fully defines any
 * other, so a workspace missing its seeded rows grants `admin`, `member`
 * and `viewer` nothing, exactly as before.
 */
export function workspaceRoleStatements(
  stored: readonly StoredRole[],
): Map<string, Statements> {
  const roles = new Map<string, Statements>([
    [CREATOR_ROLE, owner.statements as Statements],
  ]);
  for (const row of stored) {
    const merged: Record<string, string[]> = {};
    for (const [resource, actions] of Object.entries(roles.get(row.role) ?? {})) {
      merged[resource] = [...actions];
    }
    for (const [resource, actions] of Object.entries(parseStored(row))) {
      merged[resource] = [...new Set([...(merged[resource] ?? []), ...actions])];
    }
    roles.set(row.role, merged);
  }
  return roles;
}

function authorize(statements: Statements, request: PermissionRequest) {
  let authorized = false;
  for (const [resource, actions] of Object.entries(request)) {
    const allowed = statements[resource];
    if (!allowed || actions.length === 0) return false;
    if (!actions.every((action) => allowed.includes(action))) return false;
    authorized = true;
  }
  return authorized;
}

/** Whether any of a member's comma-separated roles grants every requested action. */
export function rolesAuthorize(
  roles: ReadonlyMap<string, Statements>,
  memberRole: string,
  permissions: PermissionRequest | undefined,
  allowCreatorAllPermissions = false,
): boolean {
  if (!permissions) return false;
  const names = memberRole.split(",");
  if (allowCreatorAllPermissions && names.includes(CREATOR_ROLE)) return true;
  return names.some((name) => {
    const statements = roles.get(name);
    return statements !== undefined && authorize(statements, permissions);
  });
}
