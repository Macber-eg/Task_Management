import type { Request } from "express";

const AUTH_PREFIX = "/api/auth";

/**
 * The route relative to `/api/auth` (`/sign-in/email`), the form the
 * previous backend's hooks and plugins matched on. Read from the original
 * URL: `request.path` is relative to the router under the global prefix.
 */
export function authPath(request: Request): string {
  const path = request.originalUrl.split("?")[0] ?? "";
  return path.startsWith(`${AUTH_PREFIX}/`)
    ? path.slice(AUTH_PREFIX.length)
    : path;
}
