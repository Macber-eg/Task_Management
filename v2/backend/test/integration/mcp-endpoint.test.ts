import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserEntity } from "../../src/database/entities/user.entity";
import { McpCodeExchange } from "../../src/mcp/oauth/code-exchange.service";
import { McpOauthFlowState } from "../../src/mcp/oauth/oauth-flow-state.service";
import { signUpBrowser } from "../support/browser";
import { createUser } from "../support/fixtures/create-user";
import {
  callMcp,
  LEGACY_PROTOCOL,
  legacyRpc,
  modernRpc,
  pkceChallenge,
  rpcBody,
  testAppBaseUrl,
} from "../support/fixtures/mcp-client";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const initializeLegacy = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: LEGACY_PROTOCOL,
    capabilities: {},
    clientInfo: { name: "legacy-test", version: "1.0.0" },
  },
};

describe("API integration: the MCP endpoint", () => {
  let app: TestApp;
  let user: UserEntity;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  /** An OAuth-issued token for the user, without the browser steps. */
  async function issueToken(userId: string): Promise<string> {
    const verifier = "endpoint-verifier";
    const redirectUri = "https://client.example/callback";
    const flowState = app.get(McpOauthFlowState);
    const code = await flowState.createAuthCode({
      clientId: "client",
      userId,
      codeChallenge: pkceChallenge(verifier),
      redirectUri,
    });
    const issued = await app
      .get(McpCodeExchange)
      .exchange(code, "client", verifier, redirectUri);
    return issued?.accessToken ?? "";
  }

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.stubEnv("KANEO_API_URL", "http://public.test:5273/api");
    vi.stubEnv("KANEO_INTERNAL_API_URL", testAppBaseUrl(app));
    user = await createUser(app.db, {
      name: "Test User",
      role: "user",
      email: "test@example.com",
    });
    token = await issueToken(user.id);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("discovery", () => {
    const resource = {
      resource: "http://public.test:5273/api/mcp",
      authorization_servers: ["http://public.test:5273/api"],
    };
    const authorizationServer = {
      issuer: "http://public.test:5273/api",
      authorization_endpoint: "http://public.test:5273/api/mcp/authorize",
      token_endpoint: "http://public.test:5273/api/mcp/token",
      registration_endpoint: "http://public.test:5273/api/mcp/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };

    it.each(["", "/api"])(
      "serves both documents under %s from the public API URL",
      async (prefix) => {
        const protectedResource = await app.request(
          `${prefix}/.well-known/oauth-protected-resource/api/mcp`,
        );
        expect(protectedResource.status).toBe(200);
        expect(await protectedResource.json()).toEqual(resource);

        const server = await app.request(
          `${prefix}/.well-known/oauth-authorization-server/api`,
        );
        expect(server.status).toBe(200);
        expect(await server.json()).toEqual(authorizationServer);
      },
    );

    it.each([
      ["http://public.test:5273/api/", "http://public.test:5273"],
      ["http://public.test:5273", "http://public.test:5273"],
      ["https://kaneo.example/sub/api?x=1#y", "https://kaneo.example/sub"],
    ])("derives the documents from KANEO_API_URL %s", async (apiUrl, base) => {
      vi.stubEnv("KANEO_API_URL", apiUrl);
      const response = await app.request(
        "/.well-known/oauth-protected-resource/api/mcp",
      );
      expect(await response.json()).toEqual({
        resource: `${base}/api/mcp`,
        authorization_servers: [`${base}/api`],
      });
    });

    it("leaves other root paths unserved", async () => {
      const response = await app.request("/.well-known/unknown");
      expect(response.status).toBe(404);
    });
  });

  it("challenges a missing or invalid token with the resource metadata URL", async () => {
    for (const authorization of [null, "invalid-token"]) {
      const response = await callMcp(
        app,
        authorization,
        modernRpc("tools/list", 1),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer resource_metadata="http://public.test:5273/api/.well-known/oauth-protected-resource/api/mcp"',
      );
      expect(await response.json()).toEqual({
        error: "invalid_token",
        error_description: "Missing or invalid token",
      });
    }
  });

  it("refuses an API key, which is not a login session", async () => {
    const { key } = await seedApiKey(app.db, user.id);
    const response = await callMcp(app, key, modernRpc("tools/list", 1));
    expect(response.status).toBe(401);
  });

  it("accepts a browser access token as well", async () => {
    const browser = await signUpBrowser(app, "browser@example.com");
    const refreshed = await browser.post("/api/auth/refresh");
    const { token: accessToken } = (await refreshed.json()) as { token: string };
    const response = await callMcp(app, accessToken, modernRpc("tools/list", 1));
    expect(response.status).toBe(200);
  });

  it("stops serving a token once its owner is banned", async () => {
    expect((await callMcp(app, token, modernRpc("tools/list", 1))).status).toBe(
      200,
    );
    await app.db.update(UserEntity, { id: user.id }, { banned: true });
    expect((await callMcp(app, token, modernRpc("tools/list", 2))).status).toBe(
      401,
    );
  });

  it("serves tools/list on independent requests without session IDs", async () => {
    const first = await callMcp(app, token, modernRpc("tools/list", 1));
    const second = await callMcp(app, token, modernRpc("tools/list", 2));
    const firstBody = await rpcBody(first);
    const secondBody = await rpcBody(second);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.has("mcp-session-id")).toBe(false);
    expect(firstBody.result.tools).toEqual(secondBody.result.tools);
    expect(firstBody.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "whoami",
        "list_workspaces",
        "list_projects",
        "update_task",
        "list_notifications",
      ]),
    );
  });

  it("handles concurrent calls, each authenticated and answered without secrets", async () => {
    const responses = await Promise.all(
      [1, 2, 3, 4].map((id) =>
        callMcp(
          app,
          token,
          modernRpc("tools/call", id, { name: "whoami", arguments: {} }),
        ),
      ),
    );
    const bodies = await Promise.all(responses.map(rpcBody));

    expect(responses.every((response) => response.status === 200)).toBe(true);
    for (const body of bodies) {
      expect(JSON.parse(body.result.content[0]?.text ?? "")).toEqual({
        id: user.id,
        name: "Test User",
        email: "test@example.com",
        role: "user",
      });
      expect(JSON.stringify(body)).not.toContain(token);
    }
  });

  it("returns a tool error rather than throwing when arguments fail validation", async () => {
    const response = await callMcp(
      app,
      token,
      modernRpc("tools/call", 1, { name: "get_task", arguments: { taskId: "" } }),
    );
    const body = await rpcBody(response);

    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("taskId");
  });

  it("rejects a modern request without the required per-request metadata", async () => {
    const response = await callMcp(app, token, {
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-method": "tools/list",
        "mcp-protocol-version": "2026-07-28",
      },
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    const body = await rpcBody(response);

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("rejects non-POST requests after authenticating them", async () => {
    const response = await app.request("/api/mcp", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Method not allowed" });

    const unauthenticated = await app.request("/api/mcp", { method: "DELETE" });
    expect(unauthenticated.status).toBe(401);
  });

  it.each([
    ["text/plain", "text/plain"],
    ["a form post", "application/x-www-form-urlencoded"],
    ["a missing header", undefined],
  ])(
    "rejects %s with 415 before either era is dispatched",
    async (_label, contentType) => {
      const response = await app.request("/api/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          ...(contentType ? { "content-type": contentType } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: "Unsupported Media Type" });
    },
  );

  it("accepts a parameterised json media type", async () => {
    const rpc = legacyRpc(initializeLegacy);
    const response = await callMcp(app, token, {
      ...rpc,
      headers: {
        ...rpc.headers,
        "content-type": "application/json; charset=utf-8",
      },
    });
    expect(response.status).toBe(200);
  });

  it("serves a legacy conversation statelessly, including old session IDs", async () => {
    const initialize = await callMcp(app, token, legacyRpc(initializeLegacy));
    expect(initialize.status).toBe(200);
    expect(initialize.headers.has("mcp-session-id")).toBe(false);

    const initialized = await callMcp(
      app,
      token,
      legacyRpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(initialized.status).toBe(202);

    const toolsRpc = legacyRpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const tools = await callMcp(app, token, {
      ...toolsRpc,
      headers: { ...toolsRpc.headers, "mcp-session-id": "missing-session" },
    });
    expect(tools.status).toBe(200);
    expect(tools.headers.has("mcp-session-id")).toBe(false);
    expect((await rpcBody(tools)).result.tools).toContainEqual(
      expect.objectContaining({ name: "whoami" }),
    );

    const call = await callMcp(
      app,
      token,
      legacyRpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      }),
    );
    const callBody = await rpcBody(call);
    expect(call.status).toBe(200);
    expect(JSON.parse(callBody.result.content[0]?.text ?? "")).toMatchObject({
      id: user.id,
      email: "test@example.com",
    });
    expect(JSON.stringify(callBody)).not.toContain(token);

    const unauthenticated = await callMcp(app, null, {
      ...toolsRpc,
      headers: { ...toolsRpc.headers, "mcp-session-id": "missing-session" },
    });
    expect(unauthenticated.status).toBe(401);
  });

  it("calls the REST API at KANEO_INTERNAL_API_URL, with or without /api and slashes", async () => {
    for (const internal of [
      `${testAppBaseUrl(app)}/api/`,
      `${testAppBaseUrl(app)}/`,
    ]) {
      vi.stubEnv("KANEO_INTERNAL_API_URL", internal);
      const response = await callMcp(
        app,
        token,
        modernRpc("tools/call", 1, { name: "whoami", arguments: {} }),
      );
      const body = await rpcBody(response);
      expect(body.result.isError).toBe(false);
    }

    vi.stubEnv("KANEO_INTERNAL_API_URL", "http://127.0.0.1:9/api");
    const unreachable = await rpcBody(
      await callMcp(
        app,
        token,
        modernRpc("tools/call", 2, { name: "whoami", arguments: {} }),
      ),
    );
    expect(unreachable.result.isError).toBe(true);
  });

  it("falls back to this server over loopback when no internal URL is set", async () => {
    vi.stubEnv("KANEO_INTERNAL_API_URL", "");
    const body = await rpcBody(
      await callMcp(
        app,
        token,
        modernRpc("tools/call", 1, { name: "whoami", arguments: {} }),
      ),
    );
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]?.text).toContain(user.id);
  });
});
