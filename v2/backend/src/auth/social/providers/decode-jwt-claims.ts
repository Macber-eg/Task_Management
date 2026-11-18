/**
 * The claims of a JWT, unverified. Only for ID tokens received directly from
 * the provider's token endpoint over TLS, where the transport vouches for
 * them; returns null for anything that is not a JWT with an object payload.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
