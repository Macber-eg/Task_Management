import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors/api-error";
import { resolveCorsOrigins } from "./cors-options";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function apiOrigin(): string | undefined {
  try {
    return new URL(process.env.KANEO_API_URL || "").origin;
  } catch {
    return undefined;
  }
}

/**
 * Refuses state-changing requests that carry cookies from an origin the API
 * does not trust. CORS alone does not cover this: a cross-site form post or
 * a multipart upload is sent without a preflight, and the session cookies
 * may be `SameSite=None`. Requests with a Bearer token or API key, and
 * non-browser clients (no Origin header), are not affected.
 */
export function originCheck(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  const origin = request.get("origin");
  if (
    SAFE_METHODS.has(request.method) ||
    !origin ||
    !request.headers.cookie ||
    request.get("authorization") ||
    request.get("x-api-key")
  ) {
    next();
    return;
  }

  const configured = resolveCorsOrigins();
  // Outside production an unconfigured instance accepts any origin, as its
  // CORS policy does.
  if (!configured && process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const trusted = new Set(configured ?? []);
  const own = apiOrigin();
  if (own) trusted.add(own);

  if (trusted.has(origin)) {
    next();
    return;
  }
  next(new ApiError(403, { code: "INVALID_ORIGIN", message: "Invalid origin" }));
}
