/** `user.role` holds comma-separated instance roles; `admin` runs the instance. */
export function hasInstanceAdminRole(role: unknown) {
  return typeof role === "string" && role.split(",").includes("admin");
}

/** SQL for the same test against a column or alias, e.g. `u.role`. */
export function instanceAdminRoleSql(column: string) {
  return `'admin' = ANY(string_to_array(${column}, ','))`;
}
