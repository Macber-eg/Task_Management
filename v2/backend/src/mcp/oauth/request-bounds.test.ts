import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HTTPException } from "../../common/errors/http-exception";
import { rawBodyText } from "./bounded-raw-body";
import {
  OAUTH_BODY_BYTES,
  OAUTH_MAX_IN_FLIGHT,
  mcpOauthRequestBounds,
} from "./request-bounds";

const parse = vi.fn((text: string) => text);
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/mcp", mcpOauthRequestBounds);
  app.post("/api/mcp/register", (request, response) => {
    response.json({ body: request.body as unknown });
  });
  app.post("/api/mcp/token", (request, response) => {
    response.type("text/plain").send(parse(rawBodyText(request)));
  });
  app.post("/api/mcp", (_request, response) => {
    response.send("endpoint");
  });
  app.use(
    (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
      const status = error instanceof HTTPException ? error.status : 500;
      response.status(status).send(String(status));
    },
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  vi.clearAllMocks();
});

function post(path: string, body: RequestInit["body"], headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

describe("OAuth request bounds", () => {
  it("cancels an over-limit chunked stream without invoking the parser", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(16 * 1024));
      },
      cancel,
    });
    const response = await post("/api/mcp/token", body).catch(() => null);
    // The server may close the connection once it answered.
    if (response) expect(response.status).toBe(413);
    expect(parse).not.toHaveBeenCalled();
  });

  it("refuses a declared length over the limit at once", async () => {
    const response = await post(
      "/api/mcp/register",
      JSON.stringify({ ignored: "x".repeat(OAUTH_BODY_BYTES) }),
      { "content-type": "application/json" },
    );
    expect(response.status).toBe(413);
  });

  it("accepts a body exactly at the byte limit, keeping its raw text", async () => {
    const body = "x".repeat(OAUTH_BODY_BYTES);
    const response = await post("/api/mcp/token", body);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
  });

  it("parses JSON for the registration endpoint", async () => {
    const response = await post(
      "/api/mcp/register",
      JSON.stringify({ redirect_uris: ["https://client.example"] }),
      { "content-type": "application/json" },
    );
    expect(await response.json()).toEqual({
      body: { redirect_uris: ["https://client.example"] },
    });
  });

  it("leaves the MCP endpoint itself alone", async () => {
    const response = await post("/api/mcp", "x".repeat(OAUTH_BODY_BYTES + 1));
    expect(await response.text()).toBe("endpoint");
  });

  it("refuses an OAuth URL over the length limit", async () => {
    const response = await fetch(
      `${baseUrl}/api/mcp/authorize?state=${"s".repeat(9000)}`,
    );
    expect(response.status).toBe(414);
  });

  it(
    "bounds simultaneous slow requests and releases capacity after their deadlines",
    async () => {
      const controllers: ReadableStreamDefaultController[] = [];
      const pending = Array.from({ length: OAUTH_MAX_IN_FLIGHT }, () =>
        post(
          "/api/mcp/register",
          new ReadableStream({
            start(controller) {
              controllers.push(controller);
              controller.enqueue(new TextEncoder().encode("{"));
            },
          }),
          { "content-type": "application/json" },
        ).catch(() => null),
      );
      await vi.waitFor(async () => {
        const denied = await post("/api/mcp/register", "small");
        expect(denied.status).toBe(429);
        expect(denied.headers.get("retry-after")).toBe("1");
        expect(denied.headers.get("cache-control")).toBe("no-store");
        expect(await denied.json()).toEqual({ error: "temporarily_unavailable" });
      });

      // Another group keeps its own capacity.
      expect((await post("/api/mcp/token", "small")).status).toBe(200);

      const settled = await Promise.all(pending);
      for (const response of settled) {
        if (response) expect(response.status).toBe(408);
      }
      await vi.waitFor(async () => {
        expect((await post("/api/mcp/register", "small")).status).toBe(200);
      });
    },
    20_000,
  );
});
