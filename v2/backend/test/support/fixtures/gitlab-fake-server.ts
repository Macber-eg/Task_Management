import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type GitlabRequest = {
  method: string;
  /** Path without the query string, still percent-encoded (`/api/v4/projects/acme%2Fweb`). */
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: unknown;
};

type Reply = { status?: number; body?: unknown };
type Responder = (request: GitlabRequest) => Reply | Promise<Reply>;

/**
 * A stand-in GitLab REST API on an ephemeral 127.0.0.1 port. Routes answer by
 * `METHOD path` (query ignored); anything unrouted is GitLab's 404. Every
 * request is recorded. Tests must allow private destinations to reach it.
 */
export async function startGitlabFakeServer() {
  const requests: GitlabRequest[] = [];
  const routes = new Map<string, Responder>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        // Recorded as text.
      }
      const request: GitlabRequest = {
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      };
      requests.push(request);
      const route = routes.get(`${request.method} ${request.path}`);
      const reply = route
        ? await route(request)
        : { status: 404, body: { message: "404 Not found" } };
      res.writeHead(reply.status ?? 200, {
        "Content-Type": "application/json",
      });
      res.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    requests,
    /** Answers `METHOD path` with a JSON body (or a responder). */
    on(method: string, path: string, reply: Responder | unknown) {
      routes.set(
        `${method} ${path}`,
        typeof reply === "function"
          ? (reply as Responder)
          : () => ({ body: reply }),
      );
    },
    /** The requests made to `METHOD path`. */
    calls(method: string, path: string) {
      return requests.filter(
        (request) => request.method === method && request.path === path,
      );
    },
    reset() {
      requests.length = 0;
      routes.clear();
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type GitlabFakeServer = Awaited<ReturnType<typeof startGitlabFakeServer>>;

/** The API path of a project (`acme/web` → `/api/v4/projects/acme%2Fweb`). */
export function gitlabProjectApi(projectPath: string): string {
  return `/api/v4/projects/${encodeURIComponent(projectPath)}`;
}
