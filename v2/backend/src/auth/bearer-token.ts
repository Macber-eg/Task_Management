/**
 * Reads `Authorization: Bearer <token>`. A header that starts with `Bearer`
 * but is not well formed is `malformed`, which callers reject outright
 * rather than falling back to cookies.
 */
export function parseBearerToken(authHeader: string | undefined): {
  token: string | null;
  malformed: boolean;
} {
  if (!authHeader) return { token: null, malformed: false };
  if (!/^Bearer\b/i.test(authHeader)) return { token: null, malformed: false };

  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  if (!match) return { token: null, malformed: true };
  return { token: match[1] ?? null, malformed: false };
}
