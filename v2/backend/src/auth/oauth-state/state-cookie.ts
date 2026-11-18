import { createHmac } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { resolveAuthSecret } from "../../config/auth-secret";
import { resolveCookieAttributes } from "../cookies/cookie-attributes";
import { verifySignedSessionToken } from "../legacy-session-token";

// The previous backend's name and format (`<state>.<base64 HMAC-SHA256>`),
// so a sign-in started before an upgrade can still finish after it.
const STATE_COOKIE = "better-auth.state";
const SECURE_PREFIX = "__Secure-";
const STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

function options(): CookieOptions {
  const attributes = resolveCookieAttributes();
  return {
    httpOnly: true,
    path: "/",
    sameSite: attributes.sameSite,
    secure: attributes.secure,
    partitioned: attributes.partitioned,
    domain: attributes.domain,
  };
}

function cookieName(): string {
  return resolveCookieAttributes().secure
    ? `${SECURE_PREFIX}${STATE_COOKIE}`
    : STATE_COOKIE;
}

/**
 * Binds an OAuth `state` to the browser that started the flow: the callback
 * is only honored when it arrives with this cookie.
 */
export function setStateCookie(response: Response, state: string): void {
  const signature = createHmac("sha256", resolveAuthSecret())
    .update(state)
    .digest("base64");
  response.cookie(cookieName(), `${state}.${signature}`, {
    ...options(),
    maxAge: STATE_COOKIE_MAX_AGE_MS,
  });
}

export function readStateCookie(request: Request): string | null {
  const cookies = (request as Request & { cookies?: Record<string, unknown> })
    .cookies;
  const value = cookies?.[cookieName()];
  if (typeof value !== "string" || !value) return null;
  return verifySignedSessionToken(value, resolveAuthSecret());
}

export function clearStateCookie(response: Response): void {
  response.clearCookie(cookieName(), options());
}
