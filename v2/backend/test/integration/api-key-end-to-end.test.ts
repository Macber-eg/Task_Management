import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApikeyEntity } from "../../src/database/entities/apikey.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { CookieJar } from "../support/cookie-jar";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { seedWorkspaceRoles } from "../support/fixtures/seed-workspace-roles";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const credentials = [
  ["x-api-key", (key: string) => ({ "x-api-key": key })],
  ["a Bearer key", (key: string) => ({ Authorization: `Bearer ${key}` })],
] as const;

/**
 * A key minted through the endpoint by a signed-in browser, then used with
 * nothing but the key: the whole path through the real request
 * authenticator, the guard, the access rules and the header mechanism.
 */
describe("API keys end to end", () => {
  let app: TestApp;

  async function mintKey() {
    const jar = new CookieJar();
    const signedUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Key Owner",
        email: "key-owner@example.com",
        password: "correct horse battery",
      }),
    });
    expect(signedUp.status).toBe(200);
    jar.store(signedUp);

    const path = "/api/auth/api-key/create";
    const created = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: jar.header(path),
      },
      body: JSON.stringify({ name: "automation" }),
    });
    expect(created.status).toBe(200);
    const { id, key } = (await created.json()) as { id: string; key: string };

    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "key-owner@example.com",
    });
    const workspace = await createWorkspace(app.db);
    await seedWorkspaceRoles(app.db, workspace.id);
    await addWorkspaceMember(app.db, workspace.id, user.id, "owner");
    return { id, key, user, workspace };
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it.each(credentials)(
    "opens a protected route via %s and reports the key's window",
    async (_, headersFor) => {
      const { key, workspace } = await mintKey();

      const response = await app.request(
        `/api/label/workspace/${workspace.id}`,
        { headers: headersFor(key) },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
      expect(response.headers.get("x-ratelimit-limit")).toBe("100");
      expect(response.headers.get("x-ratelimit-remaining")).toBe("99");
      expect(response.headers.get("x-ratelimit-reset")).toMatch(/^\d+$/);
      expect(response.headers.get("retry-after")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private");
    },
  );

  it("answers get-session with the session made up for the key", async () => {
    const { id, key, user } = await mintKey();

    const response = await app.request("/api/auth/get-session", {
      headers: { "x-api-key": key, "user-agent": "kaneo-cli" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: Record<string, unknown>;
      user: Record<string, unknown>;
    };
    expect(body.user).toMatchObject({
      id: user.id,
      email: "key-owner@example.com",
    });
    expect(body.session).toEqual({
      id,
      token: key,
      userId: user.id,
      userAgent: "kaneo-cli",
      ipAddress: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(
      (await app.db.findOneByOrFail(ApikeyEntity, { id })).requestCount,
    ).toBe(1);
  });

  it("holds a scoped key to its scope", async () => {
    const { id, key, workspace } = await mintKey();
    await app.db.update(
      ApikeyEntity,
      { id },
      { permissions: JSON.stringify({ label: ["read"] }) },
    );

    const read = await app.request(`/api/label/workspace/${workspace.id}`, {
      headers: { "x-api-key": key },
    });
    expect(read.status).toBe(200);

    const created = await app.request("/api/label", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        name: "Scoped",
        color: "#ef4444",
        workspaceId: workspace.id,
      }),
    });
    expect(created.status).toBe(403);
    expect(await readErrorBody(created)).toEqual({
      message: "Insufficient API key scope",
      code: "API_KEY_SCOPE",
      missingPermissions: ["label:create"],
    });
    expect(created.headers.get("x-ratelimit-remaining")).toBe("98");
    expect(await app.db.count(LabelEntity)).toBe(0);
  });

  it.each(credentials)(
    "answers 429 with retry headers once the window is full via %s",
    async (_, headersFor) => {
      const { id, key, workspace } = await mintKey();
      const lastRequest = new Date(Date.now() - 30_000);
      await app.db.update(
        ApikeyEntity,
        { id },
        { requestCount: 100, lastRequest },
      );

      const response = await app.request(
        `/api/label/workspace/${workspace.id}`,
        { headers: headersFor(key) },
      );

      expect(response.status).toBe(429);
      expect(await readErrorBody(response)).toEqual({
        message: "Rate limit exceeded",
        code: "RATE_LIMITED",
      });
      expect(response.headers.get("x-ratelimit-limit")).toBe("100");
      expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(response.headers.get("x-ratelimit-reset")).toBe(
        String(Math.ceil((lastRequest.getTime() + 60_000) / 1000)),
      );
      const retryAfter = Number(response.headers.get("retry-after"));
      expect(retryAfter).toBeGreaterThanOrEqual(29);
      expect(retryAfter).toBeLessThanOrEqual(30);
    },
  );

  it("stops working once the key is deleted", async () => {
    const { id, key, workspace } = await mintKey();

    const deleted = await app.request("/api/auth/api-key/delete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ keyId: id }),
    });
    expect(deleted.status).toBe(200);

    const response = await app.request(
      `/api/label/workspace/${workspace.id}`,
      { headers: { "x-api-key": key } },
    );
    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toEqual({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });
});
