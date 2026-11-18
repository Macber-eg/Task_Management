/**
 * The instance roles' permissions, as the auth library the previous backend
 * used defined them: `admin` manages users and sessions, `user` nothing.
 */
const ROLE_STATEMENTS: Record<string, Record<string, readonly string[]>> = {
  admin: {
    user: [
      "create",
      "list",
      "set-role",
      "ban",
      "impersonate",
      "delete",
      "set-password",
      "set-email",
      "get",
      "update",
    ],
    session: ["list", "revoke", "delete"],
  },
  user: { user: [], session: [] },
};

export type PermissionRequest = Record<string, readonly string[]>;

function roleAllows(
  statements: Record<string, readonly string[]>,
  request: PermissionRequest,
): boolean {
  let authorized = false;
  for (const [resource, actions] of Object.entries(request)) {
    const allowed = statements[resource];
    if (!allowed) return false;
    if (
      actions.length === 0 ||
      !actions.every((action) => allowed.includes(action))
    )
      return false;
    authorized = true;
  }
  return authorized;
}

/**
 * Whether any of the comma-separated roles grants every requested action.
 * A missing role counts as `user`.
 */
export function hasAdminPermission(
  role: string | null | undefined,
  request: PermissionRequest,
): boolean {
  for (const name of (role || "user").split(",")) {
    const statements = ROLE_STATEMENTS[name];
    if (statements && roleAllows(statements, request)) return true;
  }
  return false;
}
