import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export type ReceivedRequest = {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};

/**
 * A local HTTP endpoint standing in for a webhook receiver. Answers `status`
 * (200 by default) and records each request; `next()` waits for one.
 */
export async function startWebhookServer() {
  const received: ReceivedRequest[] = [];
  const waiting: Array<(request: ReceivedRequest) => void> = [];
  let status = 200;

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const entry = {
        path: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      received.push(entry);
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end("{}");
      waiting.shift()?.(entry);
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    received,
    respondWith(code: number) {
      status = code;
    },
    next(): Promise<ReceivedRequest> {
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
