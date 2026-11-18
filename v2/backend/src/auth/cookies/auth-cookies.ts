import type { CookieOptions, Request, Response } from "express";
import { resolveCookieAttributes } from "./cookie-attributes";

const ACCESS_COOKIE = "kaneo.access_token";
const REFRESH_COOKIE = "kaneo.refresh_token";
const LEGACY_SESSION_COOKIE = "better-auth.session_token";
const SECURE_PREFIX = "__Secure-";

// The access token rides on every API call and on the WebSocket handshake.
const ACCESS_PATH = "/api";
// The refresh token is only ever needed by the auth endpoints, so it is not
// exposed to the rest of the API surface.
const REFRESH_PATH = "/api/auth";

type CookieJar = Record<string, unknown> | undefined;

function baseOptions(path: string): CookieOptions {
  const attributes = resolveCookieAttributes();
  return {
    httpOnly: true,
    path,
    sameSite: attributes.sameSite,
    secure: attributes.secure,
    partitioned: attributes.partitioned,
    domain: attributes.domain,
  };
}

function cookieName(name: string): string {
  return resolveCookieAttributes().secure ? `${SECURE_PREFIX}${name}` : name;
}

function readCookie(request: Request, name: string): string | null {
  const cookies = (request as Request & { cookies?: CookieJar }).cookies;
  for (const candidate of [`${SECURE_PREFIX}${name}`, name]) {
    const value = cookies?.[candidate];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function readAccessCookie(request: Request): string | null {
  return readCookie(request, ACCESS_COOKIE);
}

export function readRefreshCookie(request: Request): string | null {
  return readCookie(request, REFRESH_COOKIE);
}

export function setAuthCookies(
  response: Response,
  tokens: {
    accessToken: string;
    accessTtlSeconds: number;
    /** Omitted when only the access token is reissued. */
    refreshToken?: string;
    refreshExpiresAt?: Date;
  },
): void {
  response.cookie(cookieName(ACCESS_COOKIE), tokens.accessToken, {
    ...baseOptions(ACCESS_PATH),
    maxAge: tokens.accessTtlSeconds * 1000,
  });
  if (tokens.refreshToken) {
    response.cookie(cookieName(REFRESH_COOKIE), tokens.refreshToken, {
      ...baseOptions(REFRESH_PATH),
      expires: tokens.refreshExpiresAt,
    });
  }
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(cookieName(ACCESS_COOKIE), baseOptions(ACCESS_PATH));
  response.clearCookie(cookieName(REFRESH_COOKIE), baseOptions(REFRESH_PATH));
}

/** Removes the previous backend's session cookie once its login is upgraded. */
export function clearLegacySessionCookie(response: Response): void {
  for (const name of [
    LEGACY_SESSION_COOKIE,
    `${SECURE_PREFIX}${LEGACY_SESSION_COOKIE}`,
  ]) {
    response.clearCookie(name, baseOptions("/"));
  }
}
