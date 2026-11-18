import type { Request } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordedApiKeyHeaders } from "../../src/auth/api-key/api-key-headers";
import { ApiKeyVerifier } from "../../src/auth/api-key/api-key-verifier";
import { DatabaseApiKeyAuthenticator } from "../../src/auth/api-key/database-api-key-authenticator";
import { ApikeyEntity } from "../../src/database/entities/apikey.entity";
import { createUser } from "../support/fixtures/create-user";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API key accounting", () => {
  let app: TestApp;
  let verifier: ApiKeyVerifier;

  async function seedKey(overrides: Partial<ApikeyEntity> = {}) {
    const user = await createUser(app.db);
    return seedApiKey(app.db, user.id, {
      rateLimitEnabled: true,
      rateLimitMax: 2,
      rateLimitTimeWindow: 60_000,
      ...overrides,
    });
  }

  function savedKey(id: string) {
    return app.db.findOneOrFail(ApikeyEntity, { where: { id } });
  }

  /** Holds the key's row lock, as a concurrent verification would. */
  async function holdRowLock(id: string) {
    let release!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = app.dataSource.transaction(async (manager) => {
      await manager.findOne(ApikeyEntity, {
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      ready();
      await hold;
    });
    await locked;
    return { release, holder };
  }

  beforeAll(async () => {
    app = await createTestApp();
    verifier = app.get(ApiKeyVerifier);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("authenticates a key as its owner, with neither user nor session, until its window is full", async () => {
    const authenticator = app.get(DatabaseApiKeyAuthenticator);
    const { key, row } = await seedKey({
      permissions: JSON.stringify({ task: ["read"] }),
    });

    const request = {} as Request;
    expect(
      await authenticator.authenticate(key, { consume: true }, request),
    ).toEqual({
      userId: row.referenceId,
      userEmail: "",
      user: null,
      session: null,
      apiKey: {
        id: row.id,
        userId: row.referenceId,
        enabled: true,
        permissions: { task: ["read"] },
      },
    });
    expect(recordedApiKeyHeaders(request)).toEqual({
      "X-RateLimit-Limit": "2",
      "X-RateLimit-Remaining": "1",
      "X-RateLimit-Reset": expect.stringMatching(/^\d+$/),
    });

    await authenticator.authenticate(key, { consume: true }, {} as Request);
    const refused = {} as Request;
    await expect(
      authenticator.authenticate(key, { consume: true }, refused),
    ).rejects.toMatchObject({ status: 429, message: "Rate limit exceeded" });
    expect(recordedApiKeyHeaders(refused)).toEqual({});

    expect(
      await authenticator.authenticate("unknown", { consume: true }, refused),
    ).toBeNull();
  });

  it("denies an exhausted quota", async () => {
    const { key } = await seedKey({ remaining: 0 });

    expect(await verifier.verify(key, { consume: true })).toEqual({
      status: "usage_exceeded",
      retryAt: null,
      rateLimit: { limit: 2, remaining: 2, resetAt: expect.any(Date) },
    });
  });

  it("enforces a rate window across concurrent requests", async () => {
    const { key, row } = await seedKey();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => verifier.verify(key, { consume: true })),
    );

    expect(results.filter((r) => r?.status === "valid")).toHaveLength(2);
    expect(results.filter((r) => r?.status === "rate_limited")).toHaveLength(4);
    expect((await savedKey(row.id)).requestCount).toBe(2);
  });

  it("atomically consumes the last remaining request", async () => {
    const { key } = await seedKey({ remaining: 1, rateLimitEnabled: false });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => verifier.verify(key, { consume: true })),
    );

    expect(results.filter((r) => r?.status === "valid")).toHaveLength(1);
    expect(results.filter((r) => r?.status === "usage_exceeded")).toHaveLength(
      4,
    );
  });

  it("refills eligible quota and resets an expired window", async () => {
    const old = new Date(Date.now() - 120_000);
    const { key, row } = await seedKey({
      remaining: 0,
      refillAmount: 3,
      refillInterval: 60_000,
      lastRefillAt: old,
      lastRequest: old,
      requestCount: 2,
    });

    const before = Date.now();
    expect(await verifier.verify(key, { consume: true })).toMatchObject({
      status: "valid",
    });

    const saved = await savedKey(row.id);
    expect(saved).toMatchObject({ remaining: 2, requestCount: 1 });
    expect(saved.lastRefillAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(saved.lastRequest).toEqual(saved.lastRefillAt);
    expect(saved.updatedAt).toEqual(saved.lastRequest);
  });

  it("does not spend anything when asked only to check", async () => {
    const { key, row } = await seedKey({ remaining: 1 });

    for (let i = 0; i < 3; i++) {
      expect(await verifier.verify(key, { consume: false })).toMatchObject({
        status: "valid",
        rateLimit: { limit: 2, remaining: 2 },
      });
    }

    expect(await savedKey(row.id)).toEqual(row);
  });

  it("does not consume the window counter while rate limits are disabled", async () => {
    const { key, row } = await seedKey({
      rateLimitEnabled: false,
      rateLimitMax: 1,
      requestCount: 0,
    });

    for (let i = 0; i < 3; i++) {
      expect(await verifier.verify(key, { consume: true })).toMatchObject({
        status: "valid",
        rateLimit: null,
      });
    }
    expect((await savedKey(row.id)).requestCount).toBe(0);

    await app.db.update(
      ApikeyEntity,
      { id: row.id },
      { rateLimitEnabled: true },
    );
    expect(await verifier.verify(key, { consume: true })).toMatchObject({
      status: "valid",
    });
    expect(await verifier.verify(key, { consume: true })).toMatchObject({
      status: "rate_limited",
    });
  });

  it("reads a key without waiting for its row lock", async () => {
    const { key, row } = await seedKey({ remaining: 1 });
    const { release, holder } = await holdRowLock(row.id);
    try {
      const result = await Promise.race([
        verifier.verify(key, { consume: false }),
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 2_000)),
      ]);

      expect(result).toMatchObject({
        status: "valid",
        rateLimit: { limit: 2, remaining: 2 },
      });
    } finally {
      release();
      await holder;
    }
  });

  it("rejects a key that expires while waiting for its row lock", async () => {
    const expiresAt = new Date(Date.now() + 1_200);
    const { key, row } = await seedKey({ expiresAt, remaining: 1 });
    const { release, holder } = await holdRowLock(row.id);
    try {
      const verification = verifier.verify(key, { consume: true });

      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [activity] = (await app.dataSource.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock'
               AND query LIKE '%"apikey"%'
           ) AS waiting`,
        )) as { waiting: boolean }[];
        waiting = activity?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);

      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 50)),
      );
      release();

      await expect(verification).resolves.toBeNull();
      expect(await savedKey(row.id)).toMatchObject({
        remaining: 1,
        requestCount: 0,
      });
    } finally {
      release();
      await holder;
    }
  });

  it.each([
    ["disabled", { enabled: false }],
    ["expired", { expiresAt: new Date(0) }],
  ])("rejects a %s key", async (_, state) => {
    const { key } = await seedKey(state);

    expect(await verifier.verify(key, { consume: true })).toBeNull();
    expect(await verifier.verify(key, { consume: false })).toBeNull();
  });

  it("rejects an unknown key and the stored hash itself", async () => {
    const { row } = await seedKey();

    expect(
      await verifier.verify("not-a-real-key", { consume: true }),
    ).toBeNull();
    expect(await verifier.verify(row.key, { consume: true })).toBeNull();
  });

  it("reads a stored scope, and grants nothing when it is malformed", async () => {
    const scoped = await seedKey({
      permissions: JSON.stringify({ task: ["read"] }),
    });
    const malformed = await seedKey({ permissions: "not json" });

    expect(await verifier.verify(scoped.key, { consume: true })).toMatchObject({
      key: {
        id: scoped.row.id,
        userId: scoped.row.referenceId,
        enabled: true,
        permissions: { task: ["read"] },
      },
    });
    expect(
      await verifier.verify(malformed.key, { consume: true }),
    ).toMatchObject({ key: { permissions: {} } });
  });

  it("creates keys through the endpoint with the configured 100-per-minute limit", async () => {
    const user = await createUser(app.db);
    app.auth.signIn(user);

    const response = await app.request("/api/auth/api-key/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "default limits" }),
    });
    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: string; key: string };

    const saved = await app.db.findOneOrFail(ApikeyEntity, {
      where: { id: created.id },
    });
    expect(saved.rateLimitMax).toBe(100);
    expect(saved.rateLimitTimeWindow).toBe(60_000);
    for (let i = 0; i < 11; i++) {
      expect(
        await verifier.verify(created.key, { consume: true }),
      ).toMatchObject({ status: "valid" });
    }
  });
});

describe("API key accounting on GET /api/auth/get-session", () => {
  it("charges an auth request once", async () => {
    const app = await createTestApp({ realAuth: true });
    try {
      await resetTestDatabase(app.dataSource);
      const user = await createUser(app.db);
      const { key, row } = await seedApiKey(app.db, user.id, {
        remaining: 1,
        rateLimitEnabled: false,
      });

      const response = await app.request("/api/auth/get-session", {
        headers: { "x-api-key": key },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { id: row.referenceId },
      });
      const saved = await app.db.findOneOrFail(ApikeyEntity, {
        where: { id: row.id },
      });
      expect(saved.remaining).toBe(0);
    } finally {
      await app.close();
    }
  });
});
