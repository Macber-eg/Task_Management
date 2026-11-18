import type { NextFunction, Request, Response } from "express";
import { HTTPException } from "../../common/errors/http-exception";
import { discardRest, readBoundedBody } from "./bounded-raw-body";

export const OAUTH_BODY_BYTES = 32 * 1024;
export const OAUTH_URL_BYTES = 8 * 1024;
export const OAUTH_MAX_IN_FLIGHT = 16;
const OAUTH_BODY_TIMEOUT_MS = 5_000;

type Group = "registration" | "authorization" | "token";

const OAUTH_PATH = /^\/(register|token|authorize|authorize\/request\/.+)$/;

const activeRequests: Record<Group, number> = {
  registration: 0,
  authorization: 0,
  token: 0,
};

function groupOf(path: string): Group {
  if (path.endsWith("/register")) return "registration";
  if (path.endsWith("/token")) return "token";
  return "authorization";
}

/**
 * Bounds the unauthenticated OAuth endpoints under `/api/mcp`: URL length,
 * body bytes and read time, and requests in flight per endpoint group. It
 * must run ahead of the global JSON parser, whose limit is far higher; the
 * MCP endpoint itself (`/api/mcp`) is not affected.
 */
export function mcpOauthRequestBounds(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!OAUTH_PATH.test(request.path)) {
    next();
    return;
  }

  const group = groupOf(request.path);
  if (activeRequests[group] >= OAUTH_MAX_IN_FLIGHT) {
    discardRest(request);
    response
      .status(429)
      .set({ "Retry-After": "1", "Cache-Control": "no-store" })
      .json({ error: "temporarily_unavailable" });
    return;
  }

  activeRequests[group]++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRequests[group]--;
  };
  response.once("finish", release).once("close", release);

  const url = `${request.protocol}://${request.get("host") ?? ""}${request.originalUrl}`;
  if (Buffer.byteLength(url) > OAUTH_URL_BYTES) {
    next(new HTTPException(414, { message: "OAuth URL is too long" }));
    return;
  }

  readBoundedBody(request, next, {
    maxBytes: OAUTH_BODY_BYTES,
    timeoutMs: OAUTH_BODY_TIMEOUT_MS,
    // The token endpoint parses its own body: form or JSON, and a malformed
    // one is an OAuth `invalid_request`, not the API's parse error.
    parseJson: group !== "token",
  });
}
