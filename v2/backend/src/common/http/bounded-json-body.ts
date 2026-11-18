import type { NextFunction, Request, Response } from "express";
import { HTTPException } from "../errors/http-exception";

// A refused upload is discarded this long before the connection is dropped:
// closing at once would reset it and could lose the response in transit.
const REFUSED_BODY_LINGER_MS = 1_000;

function discardRest(request: Request) {
  const drop = setTimeout(() => request.destroy(), REFUSED_BODY_LINGER_MS);
  request.once("end", () => clearTimeout(drop));
  request.once("close", () => clearTimeout(drop));
  request.resume();
}

/**
 * Reads a request body under a byte bound tighter than the global parser's,
 * within `timeoutMs`, and parses it when it is JSON. Actual bytes are counted,
 * so a chunked body is bounded too. Register it before the global parser,
 * which leaves an already-read body alone.
 */
export function boundedJsonBody(maxBytes: number, timeoutMs = 5_000) {
  return (request: Request, _response: Response, next: NextFunction) => {
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

    if (declared > maxBytes) {
      refuse(413, "Request body is too large");
      return;
    }

    // A fixed buffer also bounds memory for adversarial one-byte chunks.
    const bytes = Buffer.allocUnsafe(maxBytes);
    let size = 0;

    const stop = () => {
      clearTimeout(timeout);
      request.off("data", onData).off("end", onEnd).off("close", stop);
    };

    const onData = (chunk: Buffer) => {
      if (size + chunk.length > maxBytes) {
        stop();
        refuse(413, "Request body is too large");
        return;
      }
      chunk.copy(bytes, size);
      size += chunk.length;
    };

    const onEnd = () => {
      stop();
      if (size > 0 && request.is("application/json")) {
        try {
          request.body = JSON.parse(bytes.toString("utf8", 0, size));
        } catch {
          next(
            new HTTPException(400, {
              message: "Malformed JSON in request body",
            }),
          );
          return;
        }
      }
      next();
    };

    const timeout = setTimeout(() => {
      stop();
      refuse(408, "Request body timed out");
    }, timeoutMs);

    request.on("data", onData).on("end", onEnd).on("close", stop);
  };
}
