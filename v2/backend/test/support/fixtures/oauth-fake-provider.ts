import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  /** Form or JSON body fields. */
  body: Record<string, string>;
};

type Reply = { status: number; body: unknown };

/**
 * A local stand-in for an OAuth provider: answers whatever JSON a test sets
 * for a method and path, and records every request so the test can check
 * what the API sent (code, verifier, redirect URI, credentials).
 */
export class FakeOAuthProvider {
  readonly requests: RecordedRequest[] = [];
  private readonly replies = new Map<string, Reply>();
  private server: Server | undefined;
  baseUrl = "";

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const path = (request.url ?? "/").split("?")[0] ?? "/";
        const method = request.method ?? "GET";
        this.requests.push({
          method,
          path,
          headers: request.headers,
          body: parseBody(raw, request.headers["content-type"]),
        });
        const reply = this.replies.get(`${method} ${path}`);
        response.statusCode = reply?.status ?? 404;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(reply?.body ?? { error: "not_found" }));
      });
    });
    await new Promise<void>((resolve) =>
      this.server?.listen(0, "127.0.0.1", resolve),
    );
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  reply(method: string, path: string, body: unknown, status = 200): void {
    this.replies.set(`${method} ${path}`, { status, body });
  }

  reset(): void {
    this.requests.length = 0;
    this.replies.clear();
  }

  requestsTo(method: string, path: string): RecordedRequest[] {
    return this.requests.filter(
      (request) => request.method === method && request.path === path,
    );
  }
}

function parseBody(
  raw: string,
  contentType: string | undefined,
): Record<string, string> {
  if (!raw) return {};
  if (contentType?.includes("json")) {
    return JSON.parse(raw) as Record<string, string>;
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** An unsigned JWT: the API reads ID token claims without verifying them. */
export function fakeIdToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.signature`;
}
