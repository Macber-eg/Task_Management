import type { NextFunction, Request, Response } from "express";

const SERVED_PREFIXES = ["/api/", "/.well-known/"];

/**
 * Nest only answers unmatched routes under the global prefix; anything else
 * would fall through to Express's HTML error page. The API serves nothing
 * outside these prefixes, so those requests get a plain 404.
 */
export function outsideApiNotFound(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const path = request.path;
  if (path === "/api" || SERVED_PREFIXES.some((p) => path.startsWith(p))) {
    next();
    return;
  }
  response.status(404).type("text/plain").send("404 Not Found");
}
