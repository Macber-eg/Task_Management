import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

type RequestWithRawBody = ExpressRequest & { rawBody?: Buffer };

/**
 * The MCP SDKs serve web-standard requests. The global JSON parser has
 * usually read the body already; its raw bytes (`rawBody`, after any
 * content decoding) are replayed, otherwise the unread stream is passed on.
 */
export function toWebRequest(request: ExpressRequest): Request {
  const url = new URL(
    request.originalUrl,
    `${request.protocol}://${request.get("host") ?? "localhost"}`,
  );
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const raw = (request as RequestWithRawBody).rawBody;
  if (request.method === "GET" || request.method === "HEAD") {
    return new Request(url, { method: request.method, headers });
  }
  if (raw) {
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    headers.set("content-length", String(raw.byteLength));
    return new Request(url, { method: request.method, headers, body: raw });
  }
  if (request.readableEnded) {
    return new Request(url, { method: request.method, headers });
  }
  return new Request(url, {
    method: request.method,
    headers,
    body: Readable.toWeb(request) as unknown as ReadableStream,
    duplex: "half",
  } as RequestInit);
}

/** Streams a web-standard response (JSON or SSE) back through Express. */
export async function sendWebResponse(
  response: Response,
  target: ExpressResponse,
): Promise<void> {
  target.status(response.status);
  response.headers.forEach((value, name) => {
    target.setHeader(name, value);
  });
  if (!response.body) {
    target.end();
    return;
  }
  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeReadableStream),
    target,
  );
}
