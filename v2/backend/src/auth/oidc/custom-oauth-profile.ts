function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The display name for a user created through the generic provider: the
 * profile's name, else given + family name, else the username, else the
 * email's local part.
 */
export function mapCustomOAuthProfileToUser(profile: Record<string, unknown>): {
  name?: string;
} {
  const email = stringOrEmpty(profile.email);
  const nameFromParts = [
    stringOrEmpty(profile.given_name),
    stringOrEmpty(profile.family_name),
  ]
    .filter(Boolean)
    .join(" ");

  const fallbackName = [
    stringOrEmpty(profile.name),
    nameFromParts,
    stringOrEmpty(profile.preferred_username),
    email ? email.split("@")[0] : "",
  ].find(Boolean);

  return fallbackName ? { name: fallbackName } : {};
}
