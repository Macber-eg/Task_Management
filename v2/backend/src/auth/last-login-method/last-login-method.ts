import type { Response } from "express";
import { resolveCookieAttributes } from "../cookies/cookie-attributes";

// The web app reads this cookie to highlight the sign-in option used last,
// so its name is the one the previous backend's auth library chose.
const COOKIE_NAME = "better-auth.last_used_login_method";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The method a sign-in route stands for, from its path relative to
 * `/api/auth`, or null for routes that were never recorded (email OTP and
 * guest sign-in among them).
 */
export function resolveLoginMethod(path: string): string | null {
  if (path.startsWith("/callback/") || path.startsWith("/oauth2/callback/")) {
    return path.split("/").pop() || null;
  }
  if (path === "/sign-in/email" || path === "/sign-up/email") return "email";
  if (path.includes("siwe")) return "siwe";
  if (path.includes("/passkey/verify-authentication")) return "passkey";
  if (path.startsWith("/magic-link/verify")) return "magic-link";
  return null;
}

/** Readable by the web app's scripts on purpose: it holds no secret. */
export function setLastLoginMethodCookie(
  response: Response,
  method: string,
): void {
  const attributes = resolveCookieAttributes();
  response.cookie(COOKIE_NAME, method, {
    httpOnly: false,
    path: "/",
    maxAge: MAX_AGE_MS,
    sameSite: attributes.sameSite,
    secure: attributes.secure,
    partitioned: attributes.partitioned,
    domain: attributes.domain,
  });
}
