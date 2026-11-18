import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApikeyEntity } from "../../src/database/entities/apikey.entity";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const LIMIT = 3;
const WINDOW = 60_000;

const rateLimited = { message: "Rate limit exceeded", code: "RATE_LIMITED" };
const usageExceeded = {
  message: "API key usage limit exceeded",
  code: "RATE_LIMITED",
};

const credentials = [
  ["x-api-key", (key: string) => ({ "x-api-key": key })],
  ["a Bearer key", (key: string) => ({ Authorization: `Bearer ${key}` })],
] as const;

function limitHeaders(response: Response) {
  return {
    limit: response.headers.get("x-ratelimit-limit"),
    remaining: response.headers.get("x-ratelimit-remaining"),
    reset: response.headers.get("x-ratelimit-reset"),
    retryAfter: response.headers.get("retry-after"),
  };
}

function epochSeconds(date: Date) {
  return String(Math.ceil(date.getTime() / 1000));
}

// Ported from the previous suite, which sent the key to `/api/user/me` and
// to the auth library's routes. Here it goes to a label route and to the API
// key endpoints, through the real request authenticator.
describe("API key rate limits", () => {
  let app: TestApp;

  async function seedKey(overrides: Partial<ApikeyEntity> = {}) {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const seeded = await seedApiKey(app.db, user.id, {
      rateLimitEnabled: true,
      rateLimitMax: LIMIT,
      rateLimitTimeWindow: WINDOW,
      ...overrides,
    });
    return { ...seeded, labels: `/api/label/workspace/${workspace.id}` };
  }

  async function fillWindow(id: string, lastRequest: Date) {
    await app.db.update(
      ApikeyEntity,
      { id },
      { requestCount: LIMIT, lastRequest },
    );
  }

  function savedKey(id: string) {
    return app.db.findOneOrFail(ApikeyEntity, { where: { id } });
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

  it("reports the window on every successful key request", async () => {
    const { key, labels } = await seedKey();

    const before = Date.now();
    const first = await app.request(labels, { headers: { "x-api-key": key } });
    const after = Date.now();

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private");
    const headers = limitHeaders(first);
    expect(headers).toMatchObject({
      limit: String(LIMIT),
      remaining: String(LIMIT - 1),
      retryAfter: null,
    });
    expect(Number(headers.reset)).toBeGreaterThanOrEqual(
      Math.ceil((before + WINDOW) / 1000),
    );
    expect(Number(headers.reset)).toBeLessThanOrEqual(
      Math.ceil((after + WINDOW) / 1000),
    );

    const second = await app.request(labels, {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(second.status).toBe(200);
    expect(limitHeaders(second).remaining).toBe(String(LIMIT - 2));
  });

  it.each(credentials)(
    "answers 429 with retry headers via %s",
    async (_, headersFor) => {
      const { key, row, labels } = await seedKey();
      const lastRequest = new Date(Date.now() - 45_000);
      await fillWindow(row.id, lastRequest);

      const response = await app.request(labels, { headers: headersFor(key) });

      expect(response.status).toBe(429);
      expect(await readErrorBody(response)).toEqual(rateLimited);
      const headers = limitHeaders(response);
      expect(headers).toMatchObject({
        limit: String(LIMIT),
        remaining: "0",
        reset: epochSeconds(new Date(lastRequest.getTime() + WINDOW)),
      });
      expect(Number(headers.retryAfter)).toBeGreaterThanOrEqual(14);
      expect(Number(headers.retryAfter)).toBeLessThanOrEqual(15);

      const saved = await savedKey(row.id);
      expect(saved.requestCount).toBe(LIMIT);
      expect(saved.lastRequest?.getTime()).toBe(lastRequest.getTime());
    },
  );

  it("answers 429 on the API key endpoints", async () => {
    const { key, row } = await seedKey();

    const allowed = await app.request("/api/auth/api-key/list", {
      headers: { "x-api-key": key },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      apiKeys: [{ id: row.id }],
    });
    expect(limitHeaders(allowed)).toMatchObject({
      limit: String(LIMIT),
      remaining: String(LIMIT - 1),
    });

    await fillWindow(row.id, new Date());

    const limited = await app.request("/api/auth/api-key/list", {
      headers: { "x-api-key": key },
    });
    expect(limited.status).toBe(429);
    expect(await readErrorBody(limited)).toEqual(rateLimited);
    expect(limitHeaders(limited)).toMatchObject({
      limit: String(LIMIT),
      remaining: "0",
    });
    expect(Number(limitHeaders(limited).retryAfter)).toBeGreaterThanOrEqual(59);

    const bearer = await app.request("/api/auth/api-key/list", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(bearer.status).toBe(429);
    expect(await readErrorBody(bearer)).toEqual(rateLimited);
    expect(limitHeaders(bearer).remaining).toBe("0");
    expect(limitHeaders(bearer).retryAfter).not.toBeNull();
  });

  it("answers 429 on get-session", async () => {
    const { key, row } = await seedKey();

    const allowed = await app.request("/api/auth/get-session", {
      headers: { "x-api-key": key },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      user: { id: row.referenceId },
    });
    expect(limitHeaders(allowed)).toMatchObject({
      limit: String(LIMIT),
      remaining: String(LIMIT - 1),
    });
    expect(allowed.headers.get("cache-control")).toBe("private");

    await fillWindow(row.id, new Date());

    const limited = await app.request("/api/auth/get-session", {
      headers: { "x-api-key": key },
    });
    expect(limited.status).toBe(429);
    expect(await readErrorBody(limited)).toEqual(rateLimited);
    expect(limitHeaders(limited)).toMatchObject({
      limit: String(LIMIT),
      remaining: "0",
    });
    expect(Number(limitHeaders(limited).retryAfter)).toBeGreaterThanOrEqual(59);
  });

  it.each(credentials)(
    "reports the window on get-session when it spends the last quota unit via %s",
    async (_, headersFor) => {
      const { key, row } = await seedKey({ remaining: 1 });

      const response = await app.request("/api/auth/get-session", {
        headers: headersFor(key),
      });

      expect(response.status).toBe(200);
      expect(limitHeaders(response)).toMatchObject({
        limit: String(LIMIT),
        remaining: String(LIMIT - 1),
        retryAfter: null,
      });
      expect((await savedKey(row.id)).remaining).toBe(0);
    },
  );

  it.each(credentials)(
    "reports the window on an API key endpoint request that spends the last quota unit via %s",
    async (_, headersFor) => {
      const { key, row } = await seedKey({ remaining: 1 });

      const response = await app.request("/api/auth/api-key/list", {
        headers: headersFor(key),
      });

      expect(response.status).toBe(200);
      expect(limitHeaders(response)).toMatchObject({
        limit: String(LIMIT),
        remaining: String(LIMIT - 1),
        retryAfter: null,
      });
      expect((await savedKey(row.id)).remaining).toBe(0);
    },
  );

  it("lets the key through again after a full window", async () => {
    const { key, row, labels } = await seedKey();
    await fillWindow(row.id, new Date(Date.now() - WINDOW - 1_000));

    const response = await app.request(labels, {
      headers: { "x-api-key": key },
    });

    expect(response.status).toBe(200);
    expect(limitHeaders(response).remaining).toBe(String(LIMIT - 1));
  });

  it.each([
    ["x-api-key", { "x-api-key": "not-a-real-key" }],
    ["Bearer", { Authorization: "Bearer not-a-real-key" }],
  ])("keeps answering 401 for an unknown key in %s", async (_, headers) => {
    const { labels } = await seedKey();

    for (const path of [labels, "/api/auth/api-key/list"]) {
      const response = await app.request(path, { headers });

      expect(response.status).toBe(401);
      expect(await readErrorBody(response)).toEqual({
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      });
      expect(limitHeaders(response)).toMatchObject({
        limit: null,
        retryAfter: null,
      });
    }
  });

  it("keeps the headers when the route itself fails", async () => {
    const { key } = await seedKey();

    const missing = await app.request("/api/label/no-such-label", {
      headers: { "x-api-key": key },
    });

    expect(missing.status).toBe(404);
    expect(await readErrorBody(missing)).toEqual({
      message: "Label not found",
      code: "NOT_FOUND",
    });
    expect(limitHeaders(missing)).toMatchObject({
      limit: String(LIMIT),
      remaining: String(LIMIT - 1),
    });
    expect(missing.headers.get("cache-control")).toBe("private");
  });

  it("answers 429 when the usage quota is exhausted", async () => {
    const lastRefillAt = new Date(Date.now() - 600_000);
    const { key, row, labels } = await seedKey({
      remaining: 0,
      refillAmount: 5,
      refillInterval: 3_600_000,
      lastRefillAt,
    });

    const response = await app.request(labels, {
      headers: { "x-api-key": key },
    });

    expect(response.status).toBe(429);
    expect(await readErrorBody(response)).toEqual(usageExceeded);
    const retryAfter = Number(limitHeaders(response).retryAfter);
    expect(retryAfter).toBeGreaterThanOrEqual(2_999);
    expect(retryAfter).toBeLessThanOrEqual(3_000);
    expect(limitHeaders(response).limit).toBeNull();
    expect((await savedKey(row.id)).remaining).toBe(0);
  });

  it("answers 429 without Retry-After when the quota never refills", async () => {
    const { key, labels } = await seedKey({ remaining: 0 });

    for (const [, headersFor] of credentials) {
      const response = await app.request(labels, { headers: headersFor(key) });
      expect(response.status).toBe(429);
      expect(await readErrorBody(response)).toEqual(usageExceeded);
      expect(limitHeaders(response).retryAfter).toBeNull();
    }
  });
});
