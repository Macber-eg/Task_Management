import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApikeyEntity } from "../../src/database/entities/apikey.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const invalidBearer = { Authorization: "Bearer not-a-real-token" };
const unauthorized = { message: "Unauthorized", code: "UNAUTHORIZED" };

// Ported from the previous suite's API key cases in the current-user,
// device-authorization, error-shape and mixed-credentials tests. Routes that
// do not exist here yet are replaced by label routes; the cases themselves
// are about which credential wins, which the request authenticator decides.
describe("API integration: API keys as request credentials", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("accepts a short, prefixed key as a Bearer credential", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const rawKey = `kaneo_test_${randomUUID()}`;
    const { row } = await seedApiKey(
      app.db,
      user.id,
      {
        name: "integration device test",
        start: rawKey.slice(0, 12),
        prefix: "kaneo",
      },
      rawKey,
    );

    const response = await app.request(`/api/label/workspace/${workspace.id}`, {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(response.status).toBe(200);
    expect(await app.db.count(ApikeyEntity, { where: { key: row.key } })).toBe(
      1,
    );
  });

  it("accepts a Bearer key on the API key endpoints", async () => {
    const { user } = await createWorkspaceMember(app.db);
    const rawKey =
      randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await seedApiKey(app.db, user.id, { name: "auth route api key" }, rawKey);

    const response = await app.request("/api/auth/api-key/list", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });

    expect(response.status).toBe(200);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["expired", { expiresAt: new Date(0) }],
  ])("rejects a %s API key", async (_, state) => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { key } = await seedApiKey(app.db, user.id, state);

    const response = await app.request(`/api/label/workspace/${workspace.id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toEqual(unauthorized);
  });

  it("keeps the API key scope, and refuses the key next to an invalid bearer token", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { key } = await seedApiKey(app.db, user.id, {
      permissions: JSON.stringify({ label: ["read"] }),
    });
    const createLabel = (headers: Record<string, string>) =>
      app.request("/api/label", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          name: "Scoped",
          color: "#ef4444",
          workspaceId: workspace.id,
        }),
      });

    const keyOnly = await createLabel({ "x-api-key": key });
    expect(keyOnly.status).toBe(403);
    expect(await readErrorBody(keyOnly)).toEqual({
      message: "Insufficient API key scope",
      code: "API_KEY_SCOPE",
      missingPermissions: ["label:create"],
    });
    // A refusal after the key was verified still spent a request on it.
    expect(keyOnly.headers.get("x-ratelimit-limit")).toBe("10");
    expect(keyOnly.headers.get("x-ratelimit-remaining")).toBe("9");
    expect(keyOnly.headers.get("cache-control")).toBe("private");

    const mixed = await createLabel({ "x-api-key": key, ...invalidBearer });
    expect(mixed.status).toBe(401);
    expect(await readErrorBody(mixed)).toEqual(unauthorized);

    expect(await app.db.count(LabelEntity)).toBe(0);
  });

  // The previous backend refused an unusable key on every auth route.
  it("answers a rejected API key on get-session with JSON", async () => {
    const response = await app.request("/api/auth/get-session", {
      headers: { "x-api-key": "not-a-real-key" },
    });

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toEqual(unauthorized);
  });

  it("refuses an unknown Bearer token on a public auth route", async () => {
    const response = await app.request("/api/auth/get-session", {
      headers: invalidBearer,
    });

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toEqual(unauthorized);
  });

  it("charges a key sent to a public auth route", async () => {
    const { user } = await createWorkspaceMember(app.db);
    const { key, row } = await seedApiKey(app.db, user.id);

    const response = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { "x-api-key": key },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-remaining")).toBe("9");
    const saved = await app.db.findOneByOrFail(ApikeyEntity, { id: row.id });
    expect(saved.requestCount).toBe(1);
  });

  it.each([
    ["x-api-key", (key: string) => ({ "x-api-key": key })],
    ["Bearer", (key: string) => ({ Authorization: `Bearer ${key}` })],
  ])(
    "refuses a short key on the auth routes without charging it, via %s",
    async (_, headersFor) => {
      const { user, workspace } = await createWorkspaceMember(app.db);
      const rawKey = `kaneo_test_${randomUUID()}`;
      const { row } = await seedApiKey(app.db, user.id, {}, rawKey);

      const response = await app.request("/api/auth/api-key/list", {
        headers: headersFor(rawKey),
      });

      expect(response.status).toBe(403);
      expect(await readErrorBody(response)).toEqual({
        message: "Invalid API key.",
        code: "INVALID_API_KEY",
      });
      expect(response.headers.get("x-ratelimit-remaining")).toBe("10");
      const saved = await app.db.findOneByOrFail(ApikeyEntity, { id: row.id });
      expect(saved.requestCount).toBe(0);

      const elsewhere = await app.request(
        `/api/label/workspace/${workspace.id}`,
        { headers: headersFor(rawKey) },
      );
      expect(elsewhere.status).toBe(200);
    },
  );
});
