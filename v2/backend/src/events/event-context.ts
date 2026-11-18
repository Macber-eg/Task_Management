import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

/**
 * Who caused the events published while a request is handled: the user id, or
 * `userId:windowId` so a browser tab can ignore the echo of its own change.
 */
export const eventContext = new AsyncLocalStorage<{ initiatorId?: string }>();

/**
 * Opens the per-request store. The auth guard fills in `initiatorId` once it
 * knows the caller; a guard cannot open the store itself because it does not
 * wrap the rest of the request.
 */
export function eventContextMiddleware(
  _request: Request,
  _response: Response,
  next: NextFunction,
) {
  eventContext.run({}, next);
}
