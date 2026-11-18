import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { McpOauthStateEntity } from "../../src/database/entities/mcp-oauth-state.entity";
import { insertReturning } from "../../src/database/dml";
import { McpOauthFlowState } from "../../src/mcp/oauth/oauth-flow-state.service";
import { type Browser, signUpBrowser } from "../support/browser";
import {
  authorizeMcpClient,
  decide,
  pkceChallenge,
  postJson,
  redeem,
  registerClient,
  startAuthorization,
  WEB_ORIGIN,
} from "../support/fixtures/mcp-client";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: MCP OAuth security", () => {
  let app: TestApp;
  let browser: Browser;

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.stubEnv("KANEO_CLIENT_URL", WEB_ORIGIN);
    browser = await signUpBrowser(app, "victim@example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function decideAuthorization(params: {
    redirectUri: string;
    verifier: string;
    approved: boolean;
    state?: string;
  }) {
    const client = await registerClient(app, params.redirectUri);
    const requestId = await startAuthorization(
      app,
      client.client_id,
      params.redirectUri,
      params.verifier,
      params.state,
    );
    const decision = await decide(browser, requestId, params.approved);
    expect(decision.status).toBe(200);
    const body = (await decision.json()) as { redirect: string };
    return { client, callback: new URL(body.redirect) };
  }

  it("rejects empty and unsafe redirect URI registrations", async () => {
    const empty = await postJson(app, "/api/mcp/register", {
      redirect_uris: [],
    });
    expect(empty.status).toBe(400);

    for (const redirectUri of [
      "http://attacker.example/callback",
      "javascript:alert(1)",
      "https://client.example/callback#fragment",
      "https://user:pass@client.example/callback",
    ]) {
      const response = await postJson(app, "/api/mcp/register", {
        redirect_uris: [redirectUri],
      });
      expect(response.status).toBe(400);
    }
  });

  it("accepts loopback http and custom-scheme redirect URIs for native clients", async () => {
    for (const redirectUri of [
      "http://127.0.0.1:33418/callback",
      "http://localhost/callback",
      "cursor://anysphere.cursor-mcp/oauth/callback",
    ]) {
      const response = await postJson(app, "/api/mcp/register", {
        redirect_uris: [redirectUri],
      });
      expect(response.status).toBe(200);
    }
  });

  it("accepts Claude-style registration metadata and never grants refresh tokens", async () => {
    const response = await postJson(app, "/api/mcp/register", {
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_uri: "https://claude.ai",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(typeof body.client_id).toBe("string");
    expect(typeof body.client_id_issued_at).toBe("number");
  });

  it("returns RFC 7591 JSON errors for invalid registration metadata", async () => {
    const missingGrant = await postJson(app, "/api/mcp/register", {
      redirect_uris: ["https://client.example/callback"],
      grant_types: ["refresh_token"],
    });
    expect(missingGrant.status).toBe(400);
    expect(await missingGrant.json()).toEqual({
      error: "invalid_client_metadata",
      error_description:
        "grant_types: grant_types must include authorization_code",
    });

    const badRedirect = await postJson(app, "/api/mcp/register", {
      redirect_uris: ["http://attacker.example/callback"],
    });
    expect(badRedirect.status).toBe(400);
    expect(await badRedirect.json()).toEqual({
      error: "invalid_redirect_uri",
      error_description: "redirect_uris.0: Invalid redirect URI",
    });
  });

  it("returns RFC 6749 JSON errors for malformed authorization requests", async () => {
    const response = await app.request(
      "/api/mcp/authorize?response_type=code&client_id=x&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&code_challenge=abc&code_challenge_method=plain",
      { redirect: "manual" },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("rejects an unknown client and requires an exact registered redirect URI", async () => {
    const unknown = await app.request(
      `/api/mcp/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "unknown-client",
        redirect_uri: "https://client.example/callback",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      })}`,
      { redirect: "manual" },
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "invalid_client" });

    const client = await registerClient(app, "https://client.example/callback");
    const response = await app.request(
      `/api/mcp/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "https://attacker.example/collect",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      })}`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_redirect_uri" });
  });

  it("shows the consent page who is asking", async () => {
    const client = await registerClient(app);
    const requestId = await startAuthorization(
      app,
      client.client_id,
      "https://client.example/callback",
      "consent-page-verifier",
    );

    const response = await app.request(
      `/api/mcp/authorize/request/${requestId}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      client_name: "Test MCP client",
      redirect_uri: "https://client.example/callback",
    });

    const missing = await app.request("/api/mcp/authorize/request/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "invalid_or_expired_request",
    });

    const tooLong = await app.request(
      `/api/mcp/authorize/request/${"x".repeat(129)}`,
    );
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ error: "invalid_request" });
  });

  it("requires explicit same-origin approval by the signed-in browser before issuing a code", async () => {
    const redirectUri = "https://client.example/callback";
    const verifier = "attacker-known-verifier-1234567890";
    const client = await registerClient(app, redirectUri);

    const authorize = await browser.call(
      `/api/mcp/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_challenge: pkceChallenge(verifier),
        code_challenge_method: "S256",
        state: "client-state",
      })}`,
      { redirect: "manual" },
    );
    expect(authorize.status).toBe(302);
    const consentUrl = new URL(authorize.headers.get("location") ?? "");
    expect(consentUrl.origin).toBe(WEB_ORIGIN);
    expect(consentUrl.pathname).toBe("/mcp/authorize");
    expect(consentUrl.searchParams.has("code")).toBe(false);
    const requestId = consentUrl.searchParams.get("request_id") ?? "";

    // No cookie: the API's origin check does not apply, the route's does.
    const crossOrigin = await app.request(
      `/api/mcp/authorize/request/${requestId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ approved: true }),
      },
    );
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toEqual({ error: "invalid_origin" });

    const withCookieCrossOrigin = await decide(
      browser,
      requestId,
      true,
      "https://attacker.example",
    );
    expect(withCookieCrossOrigin.status).toBe(403);

    const unauthenticated = await app.request(
      `/api/mcp/authorize/request/${requestId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: WEB_ORIGIN },
        body: JSON.stringify({ approved: true }),
      },
    );
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ error: "unauthorized" });

    const approval = await decide(browser, requestId, true);
    expect(approval.status).toBe(200);
    const callback = new URL(
      ((await approval.json()) as { redirect: string }).redirect,
    );
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("client-state");
    const code = callback.searchParams.get("code") ?? "";
    expect(code).toBeTruthy();

    const token = await redeem(app, {
      code,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as Record<string, unknown>;
    expect(tokenBody).toEqual({
      access_token: expect.any(String),
      token_type: "bearer",
      expires_in: 30 * 24 * 60 * 60,
    });
    const sessions = await app.db.find(SessionEntity, {
      where: { kind: "mcp" },
    });
    expect(sessions.map((session) => session.userId)).toEqual([
      browser.userId,
    ]);

    const replay = await decide(browser, requestId, true);
    expect(replay.status).toBe(404);
  });

  it("does not let an API key or an MCP token approve a consent request", async () => {
    const mcpToken = await authorizeMcpClient(app, browser);
    const { key } = await seedApiKey(app.db, browser.userId);
    const client = await registerClient(app);
    const requestId = await startAuthorization(
      app,
      client.client_id,
      "https://client.example/callback",
      "credential-verifier",
    );

    for (const authorization of [`Bearer ${mcpToken}`, `Bearer ${key}`]) {
      const response = await app.request(
        `/api/mcp/authorize/request/${requestId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: WEB_ORIGIN,
            authorization,
          },
          body: JSON.stringify({ approved: true }),
        },
      );
      expect(response.status).toBe(401);
    }
  });

  it("denies with access_denied and preserves an explicitly empty state value", async () => {
    const { callback } = await decideAuthorization({
      redirectUri: "https://client.example/empty-state",
      verifier: "empty-state-verifier",
      approved: false,
      state: "",
    });

    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.has("state")).toBe(true);
    expect(callback.searchParams.get("state")).toBe("");
    expect(await app.db.count(McpOauthStateEntity, { where: { kind: "code" } })).toBe(0);
  });

  it("omits state from the callback when the client sent none", async () => {
    const redirectUri = "https://client.example/no-state";
    const client = await registerClient(app, redirectUri);
    const authorize = await app.request(
      `/api/mcp/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_challenge: pkceChallenge("no-state-verifier"),
        code_challenge_method: "S256",
      })}`,
      { redirect: "manual" },
    );
    const requestId =
      new URL(authorize.headers.get("location") ?? "").searchParams.get(
        "request_id",
      ) ?? "";
    const decision = await decide(browser, requestId, true);
    const callback = new URL(
      ((await decision.json()) as { redirect: string }).redirect,
    );
    expect(callback.searchParams.get("code")).toBeTruthy();
    expect(callback.searchParams.has("state")).toBe(false);
  });

  it("consumes an authorization code after a failed redemption attempt", async () => {
    const redirectUri = "https://client.example/single-use";
    const verifier = "single-use-verifier";
    const { client, callback } = await decideAuthorization({
      redirectUri,
      verifier,
      approved: true,
    });
    const code = callback.searchParams.get("code") ?? "";

    const attempt = (codeVerifier: string) =>
      redeem(app, {
        code,
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });

    const wrong = await attempt("incorrect-verifier");
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "invalid_grant" });
    expect((await attempt(verifier)).status).toBe(400);
  });

  it("rejects a code redeemed by another client or for another redirect URI", async () => {
    const redirectUri = "https://client.example/bound";
    const verifier = "bound-verifier";
    for (const mismatch of ["client", "redirect"] as const) {
      const { client, callback } = await decideAuthorization({
        redirectUri,
        verifier,
        approved: true,
      });
      const response = await redeem(app, {
        code: callback.searchParams.get("code") ?? "",
        client_id: mismatch === "client" ? "other-client" : client.client_id,
        redirect_uri:
          mismatch === "redirect" ? "https://client.example/other" : redirectUri,
        code_verifier: verifier,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_grant" });
    }
  });

  it("accepts a JSON token request and refuses other grants and malformed input", async () => {
    const redirectUri = "https://client.example/json";
    const verifier = "json-token-verifier";
    const { client, callback } = await decideAuthorization({
      redirectUri,
      verifier,
      approved: true,
    });
    const json = await postJson(app, "/api/mcp/token", {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code"),
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(json.status).toBe(200);

    const refresh = await postJson(app, "/api/mcp/token", {
      grant_type: "refresh_token",
      refresh_token: "x",
    });
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toEqual({ error: "unsupported_grant_type" });

    const malformed = await app.request("/api/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_request" });

    const tooLong = await redeem(app, {
      code: "x".repeat(129),
      client_id: "x",
      redirect_uri: redirectUri,
      code_verifier: "x",
    });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "invalid_request" });
  });

  it("sweeps expired authorization requests when creating a new one", async () => {
    const expired = await insertReturning(app.db, McpOauthStateEntity, {
      kind: "request",
      key: "expired-request",
      payload: { clientId: "client-expired" },
      expiresAt: new Date(Date.now() - 1_000),
    });
    const flowState = app.get(McpOauthFlowState);

    await flowState.createAuthorizationRequest({
      clientId: "client-current",
      redirectUri: "https://client.example/current",
      codeChallenge: "challenge",
    });

    expect(await flowState.getAuthorizationRequest("expired-request")).toBeNull();
    expect(
      await app.db.findOne(McpOauthStateEntity, { where: { id: expired?.id ?? "" } }),
    ).toBeNull();
  });
});
