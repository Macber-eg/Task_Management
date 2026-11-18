import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

const COOKIE_NAMES = [
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
];

function signature(token: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(token).digest();
}

/**
 * The previous backend's session cookie is `<token>.<base64 HMAC-SHA256>`,
 * signed with AUTH_SECRET. Returns the token when the signature verifies.
 */
export function verifySignedSessionToken(
  signed: string,
  secret: string,
): string | null {
  const separator = signed.lastIndexOf(".");
  if (separator <= 0) return null;
  const token = signed.slice(0, separator);
  const provided = Buffer.from(signed.slice(separator + 1), "base64");
  const expected = signature(token, secret);
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? token : null;
}

export function readLegacySessionCookie(
  request: Request,
  secret: string,
): string | null {
  const cookies = (request as Request & { cookies?: Record<string, unknown> })
    .cookies;
  for (const name of COOKIE_NAMES) {
    const value = cookies?.[name];
    if (typeof value !== "string" || !value) continue;
    const token = verifySignedSessionToken(value, secret);
    if (token) return token;
  }
  return null;
}
