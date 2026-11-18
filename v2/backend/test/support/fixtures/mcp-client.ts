import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HttpAdapterHost } from "@nestjs/core";
import { expect } from "vitest";
import type { Browser } from "../browser";
import type { TestApp } from "../test-app";

export const MODERN_PROTOCOL = "2026-07-28";
export const LEGACY_PROTOCOL = "2025-06-18";
export const WEB_ORIGIN = "http://localhost:5173";
export const REDIRECT_URI = "https://client.example/callback";

/** The test server's own origin, for the tools' loopback calls. */
export function testAppBaseUrl(app: TestApp): string {
  const server = app.get(HttpAdapterHost).httpAdapter.getHttpServer() as {
    address(): AddressInfo;
  };
  return `http://127.0.0.1:${server.address().port}`;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function postJson(
  app: TestApp,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function registerClient(
  app: TestApp,
  redirectUri = REDIRECT_URI,
): Promise<{ client_id: string }> {
  const response = await postJson(app, "/api/mcp/register", {
    client_name: "Test MCP client",
    redirect_uris: [redirectUri],
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { client_id: string };
}

export function authorizePath(
  clientId: string,
  redirectUri: string,
  verifier: string,
  state: string | undefined = "client-state",
): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
  });
  if (state !== undefined) query.set("state", state);
  return `/api/mcp/authorize?${query}`;
}

/** Starts an authorization and returns the consent request ID. */
export async function startAuthorization(
  app: TestApp,
  clientId: string,
  redirectUri: string,
  verifier: string,
  state?: string,
): Promise<string> {
  const response = await app.request(
    authorizePath(clientId, redirectUri, verifier, state),
    { redirect: "manual" },
  );
  expect(response.status).toBe(302);
  const consentUrl = new URL(response.headers.get("location") ?? "");
  const requestId = consentUrl.searchParams.get("request_id");
  expect(requestId).toBeTruthy();
  return requestId ?? "";
}

export function decide(
  browser: Browser,
  requestId: string,
  approved: boolean,
  origin = WEB_ORIGIN,
) {
  return browser.call(`/api/mcp/authorize/request/${requestId}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ approved }),
  });
}

export function redeem(
  app: TestApp,
  params: Record<string, string>,
) {
  return app.request("/api/mcp/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", ...params }),
  });
}

/** Runs the whole flow as the signed-in browser and returns the access token. */
export async function authorizeMcpClient(
  app: TestApp,
  browser: Browser,
): Promise<string> {
  const verifier = "full-flow-verifier-0123456789";
  const client = await registerClient(app);
  const requestId = await startAuthorization(
    app,
    client.client_id,
    REDIRECT_URI,
    verifier,
  );
  const decision = await decide(browser, requestId, true);
  expect(decision.status).toBe(200);
  const { redirect } = (await decision.json()) as { redirect: string };
  const code = new URL(redirect).searchParams.get("code") ?? "";
  const token = await redeem(app, {
    code,
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  expect(token.status).toBe(200);
  const body = (await token.json()) as { access_token: string };
  return body.access_token;
}

export function modernRpc(
  method: string,
  id: number,
  params: Record<string, unknown> = {},
) {
  const name = method === "tools/call" ? String(params.name) : undefined;
  return {
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": MODERN_PROTOCOL,
      ...(name ? { "mcp-name": name } : {}),
    },
    body: {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL,
          "io.modelcontextprotocol/clientInfo": {
            name: "kaneo-test",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
  };
}

export function callMcp(
  app: TestApp,
  token: string | null,
  rpc: { headers: Record<string, string>; body: unknown },
) {
  return app.request("/api/mcp", {
    method: "POST",
    headers: {
      ...rpc.headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(rpc.body),
  });
}

export function legacyRpc(body: unknown) {
  return {
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body,
  };
}

export type RpcBody = {
  result: {
    tools: Array<{ name: string }>;
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  error?: unknown;
};

/** JSON-RPC body of a JSON or single-event SSE response. */
export async function rpcBody(response: Response): Promise<RpcBody> {
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return JSON.parse(data ?? text) as RpcBody;
}
