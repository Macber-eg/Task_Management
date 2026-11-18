/**
 * Reads a key's stored scope. `null` means the key is unrestricted; anything
 * that is not a map of resource to action names grants nothing.
 */
export function parseApiKeyPermissions(
  raw: string | null,
): Record<string, string[]> | null {
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const permissions: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(actions)) return {};
    if (actions.some((action) => typeof action !== "string")) return {};
    permissions[resource] = actions as string[];
  }
  return permissions;
}
