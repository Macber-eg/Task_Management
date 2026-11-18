import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendGotifyNotification,
  sendNtfyNotification,
  sendWebhookNotification,
} from "./push-channels";

type Received = { url?: string; headers: Record<string, unknown>; body: string };

let server: Server;
let base: string;
let received: Received[];

beforeEach(async () => {
  received = [];
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      received.push({ url: request.url, headers: request.headers, body });
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  base = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("notification push channels", () => {
  it("preserves HMAC-signed webhook payloads", async () => {
    await sendWebhookNotification({
      webhookUrl: `${base}/signed`,
      secret: "secret",
      payload: { title: "test" },
    });
    const [request] = received;
    expect(request?.body).toBe(JSON.stringify({ title: "test" }));
    expect(request?.headers["x-kaneo-signature"]).toBe(
      createHmac("sha256", "secret")
        .update(request?.body ?? "")
        .digest("hex"),
    );
  });

  it("leaves an unsigned webhook without a signature", async () => {
    await sendWebhookNotification({
      webhookUrl: `${base}/plain`,
      payload: { title: "test" },
    });
    expect(received[0]?.headers).not.toHaveProperty("x-kaneo-signature");
  });

  it("posts to the ntfy topic and the Gotify message endpoint", async () => {
    await sendNtfyNotification({
      serverUrl: `${base}//`,
      topic: "team alerts",
      token: "ntfy-token",
      title: "Title",
      body: "Body",
      clickUrl: "https://kaneo.example/task",
    });
    await sendGotifyNotification({
      serverUrl: base,
      token: "gotify token",
      title: "Title",
      body: "Body",
    });
    const [ntfy, gotify] = received;
    expect(ntfy).toMatchObject({
      url: "/team%20alerts",
      body: "Body",
      headers: {
        authorization: "Bearer ntfy-token",
        click: "https://kaneo.example/task",
        title: "Title",
      },
    });
    expect(gotify?.url).toBe("/message?token=gotify%20token");
    expect(JSON.parse(gotify?.body ?? "")).toEqual({
      title: "Title",
      message: "Body",
      priority: 5,
    });
  });
});
