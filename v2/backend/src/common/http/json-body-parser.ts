import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { HTTPException } from "../errors/http-exception";

// The previous API had no global cap; Express defaults to 100kb, which large
// task descriptions and imports exceed.
const JSON_BODY_LIMIT = "25mb";

export type RequestWithRawBody = Request & { rawBody?: Buffer };

type BodyParserError = { type?: string; status?: number };

/**
 * Parses JSON bodies and keeps the raw bytes for webhook signature checks.
 * Parse failures surface as the API's own 400 instead of Express's default.
 */
export function jsonBodyParser() {
  const parse = express.json({
    limit: JSON_BODY_LIMIT,
    verify: (request, _response, buffer) => {
      (request as RequestWithRawBody).rawBody = buffer;
    },
  });

  return (request: Request, response: Response, next: NextFunction) => {
    parse(request, response, (error?: unknown) => {
      if (!error) return next();
      const { type, status } = error as BodyParserError;
      if (type === "entity.too.large" || status === 413) {
        return next(
          new HTTPException(413, { message: "Request body is too large" }),
        );
      }
      return next(
        new HTTPException(400, { message: "Malformed JSON in request body" }),
      );
    });
  };
}
