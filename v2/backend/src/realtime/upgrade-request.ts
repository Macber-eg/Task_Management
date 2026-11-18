import type { IncomingMessage } from "node:http";
import cookieParser from "cookie-parser";
import type { Request } from "express";

const parseCookies = cookieParser();

/**
 * Express middleware never runs on an upgrade, so the handshake request gets
 * what the authenticator reads from an Express request: `get()`, parsed
 * `cookies` (with the same parser the HTTP routes use) and `ip`.
 */
export function asUpgradeRequest(incoming: IncomingMessage): Request {
  const request = incoming as IncomingMessage & {
    get?: (name: string) => string | string[] | undefined;
    ip?: string;
  };
  request.get = (name: string) => {
    const header = name.toLowerCase();
    if (header === "referer" || header === "referrer") {
      return request.headers.referrer ?? request.headers.referer;
    }
    return request.headers[header];
  };
  request.ip = incoming.socket.remoteAddress;
  parseCookies(request as unknown as Request, {} as never, () => {});
  return request as unknown as Request;
}

/** The handshake headers as a Fetch `Headers`, first value of repeated ones. */
export function upgradeHeaders(incoming: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (!value) continue;
    headers.append(key, Array.isArray(value) ? (value[0] ?? "") : value);
  }
  return headers;
}
