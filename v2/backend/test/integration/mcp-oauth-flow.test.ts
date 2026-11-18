import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashTokenSecret } from "../../src/auth/tokens/refresh-token";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { type Browser, signUpBrowser } from "../support/browser";
import {
  authorizeMcpClient,
  callMcp,
  modernRpc,
  rpcBody,
  testAppBaseUrl,
} from "../support/fixtures/mcp-client";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: MCP OAuth flow end to end", () => {
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
    vi.stubEnv("KANEO_CLIENT_URL", "http://localhost:5173");
    vi.stubEnv("KANEO_INTERNAL_API_URL", `${testAppBaseUrl(app)}/api/`);
    browser = await signUpBrowser(app, "mcp-owner@example.com", "MCP Owner");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("issues an opaque token backed by an mcp session that reaches the REST API through tools", async () => {
    const before = Date.now();
    const token = await authorizeMcpClient(app, browser);

    const sessions = await app.db.find(SessionEntity, {
      where: { userId: browser.userId, kind: "mcp" },
    });
    expect(sessions).toHaveLength(1);
    const [session] = sessions;
    expect(session?.token).toBe(hashTokenSecret(token));
    expect(session?.token).not.toBe(token);
    const lifetime = (session?.expiresAt.getTime() ?? 0) - before;
    expect(lifetime).toBeGreaterThan(30 * 24 * 60 * 60 * 1000 - 60_000);
    expect(lifetime).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 60_000);

    const created = await browser.post("/api/auth/organization/create", {
      name: "MCP Workspace",
      slug: "mcp-workspace",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };

    const whoami = await callMcp(
      app,
      token,
      modernRpc("tools/call", 1, { name: "whoami", arguments: {} }),
    );
    expect(whoami.status).toBe(200);
    const whoamiBody = await rpcBody(whoami);
    expect(whoamiBody.result.isError).toBe(false);
    expect(JSON.parse(whoamiBody.result.content[0]?.text ?? "")).toMatchObject({
      id: browser.userId,
      name: "MCP Owner",
      email: "mcp-owner@example.com",
    });
    expect(JSON.stringify(whoamiBody)).not.toContain(token);

    const workspaces = await rpcBody(
      await callMcp(
        app,
        token,
        modernRpc("tools/call", 2, { name: "list_workspaces", arguments: {} }),
      ),
    );
    expect(workspaces.result.isError).toBe(false);
    expect(JSON.parse(workspaces.result.content[0]?.text ?? "")).toEqual([
      expect.objectContaining({ id: workspace.id, name: "MCP Workspace" }),
    ]);

    const createdProject = await rpcBody(
      await callMcp(
        app,
        token,
        modernRpc("tools/call", 3, {
          name: "create_project",
          arguments: {
            name: "Launch",
            workspaceId: workspace.id,
            icon: "Layout",
            slug: "LAU",
          },
        }),
      ),
    );
    expect(createdProject.result.isError).toBe(false);

    const projects = await rpcBody(
      await callMcp(
        app,
        token,
        modernRpc("tools/call", 4, {
          name: "list_projects",
          arguments: { workspaceId: workspace.id },
        }),
      ),
    );
    expect(projects.result.isError).toBe(false);
    expect(projects.result.content[0]?.text).toContain('"name": "Launch"');
  });

  it("reports a REST API refusal as a tool error", async () => {
    const token = await authorizeMcpClient(app, browser);

    const response = await callMcp(
      app,
      token,
      modernRpc("tools/call", 1, {
        name: "list_projects",
        arguments: { workspaceId: "missing-workspace" },
      }),
    );
    const body = await rpcBody(response);

    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("/api/project?");
  });
});
