import { organizationError } from "../organization-error";

export type RoleSelector = { roleName?: string; roleId?: string };

/** Which stored role a request names: by name if given, else by id. */
export function roleCondition(
  selector: RoleSelector,
): { role: string } | { id: string } {
  if (selector.roleName) return { role: selector.roleName };
  if (selector.roleId) return { id: selector.roleId };
  throw organizationError(400, "ROLE_NOT_FOUND");
}
