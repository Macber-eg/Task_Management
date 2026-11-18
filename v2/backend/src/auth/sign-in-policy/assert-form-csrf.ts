import type { Request } from "express";
import { authError } from "../auth-error";
import { apiOrigin, clientUrl } from "../social/auth-urls";

function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function assertTrustedOrigin(request: Request): void {
  const header = request.get("origin") || request.get("referer") || "";
  if (!header || header === "null") throw authError("MISSING_OR_NULL_ORIGIN");
  const trusted = new Set([apiOrigin(), clientUrl()]);
  const origin = originOf(header);
  if (!origin || !trusted.has(origin)) throw authError("INVALID_ORIGIN");
}

/**
 * Guards the routes that email a sign-in code or link against a cross-site
 * form or navigation starting a login. With cookies the global origin check
 * applies; without, a browser identifies itself through Fetch Metadata or an
 * Origin/Referer header, and those must name the web app or the API.
 */
export function assertFormCsrf(request: Request): void {
  if (request.headers.cookie) return;
  const site = request.get("sec-fetch-site")?.trim();
  const mode = request.get("sec-fetch-mode")?.trim();
  const dest = request.get("sec-fetch-dest")?.trim();
  if (site || mode || dest) {
    if (site === "cross-site" && mode === "navigate") {
      throw authError("CROSS_SITE_NAVIGATION_LOGIN_BLOCKED");
    }
    assertTrustedOrigin(request);
    return;
  }
  if (request.get("origin") || request.get("referer")) {
    assertTrustedOrigin(request);
  }
}
