import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A refresh token is `<sessionId>.<secret>`. Only the SHA-256 of the secret
 * is stored (in `session.token`), so a database leak does not yield usable
 * tokens.
 */
export function hashTokenSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

export function newTokenSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function formatRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(
  token: string,
): { sessionId: string; secret: string } | null {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;
  return {
    sessionId: token.slice(0, separator),
    secret: token.slice(separator + 1),
  };
}

export function sameHash(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
