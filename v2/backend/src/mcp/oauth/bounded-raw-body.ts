import type { NextFunction, Request, Response } from "express";
import { HTTPException } from "../../common/errors/http-exception";

export type RequestWithRawBody = Request & { rawBody?: Buffer };

// A refused body is discarded this long before the connection is dropped:
// closing at once would reset it and could lose the response in transit.
const REFUSED_BODY_LINGER_MS = 1_000;

export function discardRest(request: Request): void {
  const drop = setTimeout(() => request.destroy(), REFUSED_BODY_LINGER_MS);
  request.once("end", () => clearTimeout(drop));
  request.once("close", () => clearTimeout(drop));
  request.resume();
}

/**
 * Reads the whole body under `maxBytes` within `timeoutMs`, counting actual
 * bytes so chunked bodies and misleading lengths are bounded too. The bytes
 * are kept as `rawBody`; with `parseJson`, a JSON body is also parsed. The
 * global parser leaves a body read here alone.
 */
export function readBoundedBody(
  request: Request,
  next: NextFunction,
  options: { maxBytes: number; timeoutMs: number; parseJson: boolean },
): void {
  const declared = Number(request.headers["content-length"]);
  const chunked = request.headers["transfer-encoding"] !== undefined;
  if (!chunked && !(declared > 0)) {
    next();
    return;
  }

  const refuse = (status: number, message: string) => {
    discardRest(request);
    next(new HTTPException(status, { message }));
  };

  if (declared > options.maxBytes) {
    refuse(413, "Request body is too large");
    return;
  }

  // A fixed buffer also bounds memory for adversarial one-byte chunks.
  const bytes = Buffer.allocUnsafe(options.maxBytes);
  let size = 0;

  const stop = () => {
    clearTimeout(timeout);
    request.off("data", onData).off("end", onEnd).off("close", stop);
  };

  const onData = (chunk: Buffer) => {
    if (size + chunk.length > options.maxBytes) {
      stop();
      refuse(413, "Request body is too large");
      return;
    }
    chunk.copy(bytes, size);
    size += chunk.length;
  };

  const onEnd = () => {
    stop();
    const raw = Buffer.from(bytes.subarray(0, size));
    (request as RequestWithRawBody).rawBody = raw;
    if (options.parseJson && size > 0 && request.is("application/json")) {
      try {
        request.body = JSON.parse(raw.toString("utf8"));
      } catch {
        next(
          new HTTPException(400, { message: "Malformed JSON in request body" }),
        );
        return;
      }
    }
    next();
  };

  const timeout = setTimeout(() => {
    stop();
    refuse(408, "Request body timed out");
  }, options.timeoutMs);

  request.on("data", onData).on("end", onEnd).on("close", stop);
}

export function rawBodyText(request: Request): string {
  return (request as RequestWithRawBody).rawBody?.toString("utf8") ?? "";
}
