import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { insertReturning } from "../../src/database/dml";
import { McpOauthStateEntity } from "../../src/database/entities/mcp-oauth-state.entity";
import { McpOauthFlowState } from "../../src/mcp/oauth/oauth-flow-state.service";
import { OAUTH_STATE_LIMITS } from "../../src/mcp/oauth/oauth-state-limits";
import { type Browser, signUpBrowser } from "../support/browser";
import {
  decide,
  pkceChallenge,
  postJson,
  WEB_ORIGIN,
} from "../support/fixtures/mcp-client";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const redirectUri = "https://client.example/callback";
const challenge = pkceChallenge("test-verifier");

describe("API integration: MCP OAuth HTTP resource bounds", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.stubEnv("KANEO_CLIENT_URL", WEB_ORIGIN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const total = (kind: string) =>
    app.db.count(McpOauthStateEntity, { where: { kind } });

  function saturateRate(key: "client" | "code") {
    return insertReturning(app.db, McpOauthStateEntity, {
      kind: "rate",
      key,
      payload: { count: OAUTH_STATE_LIMITS[key].perMinute },
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  it.each([
    { redirect_uris: Array.from({ length: 11 }, () => redirectUri) },
    { redirect_uris: [redirectUri], client_name: "x".repeat(101) },
    { redirect_uris: [`https://example.com/${"x".repeat(2048)}`] },
  ])(
    "rejects oversized registration fields before storing them: %#",
    async (body) => {
      expect((await postJson(app, "/api/mcp/register", body)).status).toBe(400);
      expect(await total("client")).toBe(0);
    },
  );

  it("rejects a body over the OAuth byte limit before parsing it", async () => {
    const response = await postJson(app, "/api/mcp/register", {
      redirect_uris: [redirectUri],
      ignored: "x".repeat(33 * 1024),
    });
    expect(response.status).toBe(413);
    expect(await total("client")).toBe(0);
  });

  it("bounds a chunked body without a Content-Length too", async () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({ redirect_uris: [redirectUri], ignored: "x".repeat(33 * 1024) }),
    );
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });
    const response = await app.request("/api/mcp/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(await total("client")).toBe(0);
  });

  it("bounds authorization fields and the raw URL before any request row is created", async () => {
    const client = await app.get(McpOauthFlowState).registerClient({
      redirectUris: [redirectUri],
    });
    const query = (field: string, value: string) =>
      new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        [field]: value,
      });
    for (const [field, value, status] of [
      ["state", "s".repeat(1025), 400],
      ["state", "s".repeat(9000), 414],
      ["code_challenge", "x".repeat(44), 400],
      ["client_id", "x".repeat(129), 400],
    ] as const) {
      const response = await app.request(
        `/api/mcp/authorize?${query(field, value)}`,
        { redirect: "manual" },
      );
      expect(response.status).toBe(status);
    }
    expect(await total("request")).toBe(0);

    const accepted = await app.request(
      `/api/mcp/authorize?${query("state", "s".repeat(1024))}`,
      { redirect: "manual" },
    );
    expect(accepted.status).toBe(302);
    expect(await total("request")).toBe(1);
  });

  it("returns a retryable JSON error at the durable registration limit", async () => {
    await saturateRate("client");
    const response = await postJson(app, "/api/mcp/register", {
      redirect_uris: [redirectUri],
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "temporarily_unavailable",
      error_description: "OAuth capacity reached; retry later",
    });
    expect(await total("client")).toBe(0);
  });

  it("allows retrying consent after capacity recovers without issuing multiple codes", async () => {
    const browser: Browser = await signUpBrowser(app, "bounds@example.com");
    const flowState = app.get(McpOauthFlowState);
    const client = await flowState.registerClient({ redirectUris: [redirectUri] });
    const id = await flowState.createAuthorizationRequest({
      clientId: client.clientId,
      codeChallenge: challenge,
      redirectUri,
    });
    await saturateRate("code");

    expect((await decide(browser, id, true)).status).toBe(429);
    expect(await flowState.getAuthorizationRequest(id)).not.toBeNull();

    await app.db.delete(McpOauthStateEntity, { kind: "rate", key: "code" });
    expect((await decide(browser, id, true)).status).toBe(200);
    expect(await flowState.getAuthorizationRequest(id)).toBeNull();
    expect((await decide(browser, id, true)).status).toBe(404);
    expect(await total("code")).toBe(1);
  });

  it.each([
    ["null", "null"],
    ["an array", "[]"],
    [
      "a non-string code",
      JSON.stringify({
        grant_type: "authorization_code",
        code: {},
        client_id: "x",
        code_verifier: "x",
        redirect_uri: redirectUri,
      }),
    ],
    ["an empty body", ""],
  ])("returns 400 for malformed token input: %s", async (_label, body) => {
    const response = await app.request("/api/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
