import { ExpressAdapter } from "@nestjs/platform-express";
import type { Response } from "express";
import { Reply } from "./reply";

/**
 * Nest fixes a handler's status from decorator metadata, so a handler that
 * answers 200 or 202 depending on the outcome has no way to say so. This
 * adapter lets a handler return `reply(status, body)` instead.
 */
export class ApiExpressAdapter extends ExpressAdapter {
  override reply(response: Response, body: unknown, statusCode?: number) {
    if (!(body instanceof Reply)) {
      return super.reply(response, body, statusCode);
    }
    response.set(body.headers);
    // Nest sends an empty body for null; clients that parse the response as
    // JSON (a missing session is `null`) need the literal.
    if (body.body === null) {
      return response.status(body.status).json(null);
    }
    return super.reply(response, body.body, body.status);
  }
}
