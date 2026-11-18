import { isLegacyRequest } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleLegacyMcpRequest } from "./legacy-handler";
import { createModernMcpHandler } from "./modern-handler";

const protocolVersion = "2026-07-28";

const currentUser = {
  id: "test-user",
  name: "Test User",
  email: "test@example.com",
  role: "user",
};

const sessionResponse = {
  user: { ...currentUser, token: "unexpected-user-secret" },
  session: {
    id: "test-session",
    token: "live-session-secret",
    expiresAt: "2026-11-08T00:00:00.000Z",
  },
};

function modernRequest(
  method: string,
  id: number,
  params: Record<string, unknown> = {},
): Request {
  const name = method === "tools/call" ? String(params.name) : undefined;
  return new Request("http://mcp.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-token",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": protocolVersion,
      ...(name ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion,
          "io.modelcontextprotocol/clientInfo": {
            name: "kaneo-stateless-test",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

type RpcBody = {
  result: {
    tools: unknown[];
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  error?: unknown;
};

async function rpcBody(response: Response): Promise<RpcBody> {
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return JSON.parse(data ?? text) as RpcBody;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP 2026-07-28 stateless HTTP", () => {
  it("serves tools/list on independent HTTP requests without session IDs", async () => {
    const handler = createModernMcpHandler("test-token", "http://api.test");

    const first = await handler.fetch(modernRequest("tools/list", 1));
    const second = await handler.fetch(modernRequest("tools/list", 2));
    const firstBody = await rpcBody(first);
    const secondBody = await rpcBody(second);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.has("mcp-session-id")).toBe(false);
    expect(second.headers.has("mcp-session-id")).toBe(false);
    expect(firstBody.result.tools).toEqual(secondBody.result.tools);
    expect(firstBody.result.tools).toContainEqual(
      expect.objectContaining({ name: "whoami" }),
    );
  });

  it("handles concurrent read-only calls with per-request authentication", async () => {
    const apiFetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer test-token",
        );
        return Response.json(sessionResponse);
      },
    );
    vi.stubGlobal("fetch", apiFetch);
    const handler = createModernMcpHandler("test-token", "http://api.test");

    const responses = await Promise.all(
      [1, 2, 3, 4].map((id) =>
        handler.fetch(
          modernRequest("tools/call", id, { name: "whoami", arguments: {} }),
        ),
      ),
    );
    const bodies = await Promise.all(responses.map(rpcBody));

    expect(apiFetch).toHaveBeenCalledTimes(4);
    expect(String(apiFetch.mock.calls[0]?.[0])).toBe(
      "http://api.test/api/auth/get-session",
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    for (const body of bodies) {
      expect(JSON.parse(body.result.content[0]?.text ?? "")).toEqual(currentUser);
      expect(JSON.stringify(body)).not.toContain("live-session-secret");
      expect(JSON.stringify(body)).not.toContain("unexpected-user-secret");
    }
  });

  it("gets one task by ticket ID through the HTTP MCP server", async () => {
    const apiFetch = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        "http://api.test/api/task/by-ticket-id/KAN-12?workspaceId=workspace+1&projectId=project+1",
      );
      return Response.json({ id: "task-1", title: "Direct match" });
    });
    vi.stubGlobal("fetch", apiFetch);
    const handler = createModernMcpHandler("test-token", "http://api.test");

    const response = await handler.fetch(
      modernRequest("tools/call", 1, {
        name: "get_task_by_ticket_id",
        arguments: {
          ticketId: "KAN-12",
          workspaceId: "workspace 1",
          projectId: "project 1",
        },
      }),
    );
    const body = await rpcBody(response);

    expect(response.status).toBe(200);
    expect(body.result.content[0]?.text).toContain("Direct match");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a modern request without the required per-request metadata", async () => {
    const handler = createModernMcpHandler("test-token", "http://api.test");
    const request = new Request("http://mcp.test/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-method": "tools/list",
        "mcp-protocol-version": protocolVersion,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    const response = await handler.fetch(request);
    const body = await rpcBody(response);

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("executes an effectful tool on a separate request", async () => {
    const apiFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe("http://api.test/api/task/status/task-1");
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer test-token",
        );
        expect(JSON.parse(String(init?.body))).toEqual({ status: "qa" });
        return Response.json({ id: "task-1", status: "qa" });
      },
    );
    vi.stubGlobal("fetch", apiFetch);
    const handler = createModernMcpHandler("test-token", "http://api.test");

    const response = await handler.fetch(
      modernRequest("tools/call", 1, {
        name: "update_task_status",
        arguments: { taskId: "task-1", status: "qa" },
      }),
    );
    const body = await rpcBody(response);

    expect(response.status).toBe(200);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(body.result.content[0]?.text).toContain('"status": "qa"');
  });

  it("tells legacy initialize traffic apart from modern requests", async () => {
    const legacy = new Request("http://mcp.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "legacy", version: "1.0.0" },
        },
      }),
    });

    expect(await isLegacyRequest(legacy)).toBe(true);
    expect(await isLegacyRequest(modernRequest("tools/list", 2))).toBe(false);
  });

  it("serves a legacy request with a fresh stateless transport", async () => {
    const response = await handleLegacyMcpRequest(
      new Request("http://mcp.test/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-session-id": "missing-session",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      }),
      "test-token",
      "http://api.test",
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("mcp-session-id")).toBe(false);
    expect((await rpcBody(response)).result.tools).toContainEqual(
      expect.objectContaining({ name: "whoami" }),
    );
  });

  it("returns a tool error rather than throwing when arguments fail validation", async () => {
    const handler = createModernMcpHandler("test-token", "http://api.test");

    const response = await handler.fetch(
      modernRequest("tools/call", 1, {
        name: "get_task",
        arguments: { taskId: "" },
      }),
    );
    const body = await rpcBody(response);

    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("taskId");
  });
});
