import type { NextFunction, Request, Response } from "express";
import { recordedApiKeyHeaders } from "./api-key-headers";
import { beforeHeadersSent } from "./before-headers-sent";
import { privateCacheControl } from "./private-cache-control";

/**
 * Adds the headers a verified API key recorded on the request (its rate
 * limit window) to the response, whatever produced it: the handler, a later
 * guard's refusal or the exception filter. Per-key headers must not be
 * served to another caller from a shared cache.
 */
export function applyApiKeyHeaders(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  beforeHeadersSent(response, () => {
    const headers = Object.entries(recordedApiKeyHeaders(request));
    if (headers.length === 0) return;
    for (const [name, value] of headers) response.setHeader(name, value);

    const cacheControl = response.getHeader("Cache-Control");
    response.setHeader(
      "Cache-Control",
      privateCacheControl(
        cacheControl === undefined ? null : String(cacheControl),
      ),
    );
  });
  next();
}
