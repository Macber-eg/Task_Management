import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpAdapterHost } from "@nestjs/core";
import { WebSocket } from "ws";
import type { TestApp } from "./test-app";

export type TestSocket = {
  socket: WebSocket;
  /** 101 once open, otherwise the refused handshake's status. */
  status: number;
  /** Every message received so far, parsed as JSON. */
  messages: unknown[];
  /** Resolves with the close code and reason. */
  closed: Promise<{ code: number; reason: string }>;
  /** Resolves with the next message whose `type` matches. */
  next(type: string): Promise<Record<string, unknown>>;
};

const openSockets = new Set<WebSocket>();

function serverUrl(app: TestApp) {
  const server = app.get(HttpAdapterHost).httpAdapter.getHttpServer();
  const { port } = server.address() as AddressInfo;
  return `ws://127.0.0.1:${port}`;
}

/**
 * Opens a WebSocket against the running test server, e.g.
 * `connectSocket(app, "/api/ws/user", { cookie, origin })`.
 */
export async function connectSocket(
  app: TestApp,
  path: string,
  headers: Record<string, string> = {},
): Promise<TestSocket> {
  const socket = new WebSocket(`${serverUrl(app)}${path}`, { headers });
  openSockets.add(socket);
  socket.on("error", () => {});
  const messages: unknown[] = [];
  const waiters: Array<{
    type: string;
    resolve: (message: Record<string, unknown>) => void;
  }> = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as Record<string, unknown>;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.type !== message.type) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  const closed = once(socket, "close").then(([code, reason]) => ({
    code: code as number,
    reason: String(reason),
  }));
  closed.catch(() => {});

  const status = await new Promise<number>((resolve) => {
    socket.once("open", () => resolve(101));
    socket.once(
      "unexpected-response",
      (_request: unknown, response: IncomingMessage) => {
        response.resume();
        resolve(response.statusCode ?? 0);
        socket.terminate();
      },
    );
    socket.once("error", () => resolve(0));
  });

  return {
    socket,
    status,
    messages,
    closed,
    next: (type) => {
      const seen = messages.find(
        (message) => (message as { type?: unknown }).type === type,
      );
      if (seen) return Promise.resolve(seen as Record<string, unknown>);
      return new Promise((resolve) => waiters.push({ type, resolve }));
    },
  };
}

/** Terminates every socket the tests opened; call in `afterEach`. */
export function closeSockets(): void {
  for (const socket of openSockets) socket.terminate();
  openSockets.clear();
}
