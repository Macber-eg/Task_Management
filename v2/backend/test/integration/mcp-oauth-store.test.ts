import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertReturning } from "../../src/database/dml";
import { McpOauthStateEntity } from "../../src/database/entities/mcp-oauth-state.entity";
import { McpOauthStore } from "../../src/mcp/oauth/oauth-state.store";
import {
  EXPIRED_STATE_BATCH,
  OAUTH_STATE_LIMITS,
} from "../../src/mcp/oauth/oauth-state-limits";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const future = () => new Date(Date.now() + 60_000);

describe("API integration: bounded shared MCP OAuth store", () => {
  let app: TestApp;
  let store: McpOauthStore;

  beforeAll(async () => {
    app = await createTestApp();
    store = app.get(McpOauthStore);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  async function seed(
    kind: "client" | "request" | "code",
    total: number,
    expired = false,
    clientId = "seed-client",
  ) {
    await app.db.query(
      `INSERT INTO mcp_oauth_state (id, kind, key, payload, expires_at)
       SELECT $1 || '-' || i, $1, $1 || '-' || i,
         jsonb_build_object('clientId', $2::text),
         CASE WHEN $3 THEN (now() AT TIME ZONE 'UTC') - interval '1 hour'
           ELSE (now() AT TIME ZONE 'UTC') + interval '1 hour' END
       FROM generate_series(1, $4::integer) AS i`,
      [kind, clientId, expired, total],
    );
  }

  const total = (kind: string) =>
    app.db.count(McpOauthStateEntity, { where: { kind } });

  function saturateRate(key: "client" | "code", expiresAt = future()) {
    return insertReturning(app.db, McpOauthStateEntity, {
      kind: "rate",
      key,
      payload: { count: OAUTH_STATE_LIMITS[key].perMinute },
      expiresAt,
    });
  }

  it("keeps live UTC timestamps through cleanup and consent approval", async () => {
    await store.put("request", "live-request", { clientId: "client" }, future());
    await insertReturning(app.db, McpOauthStateEntity, {
      kind: "request",
      key: "expired-request",
      payload: {},
      expiresAt: new Date(Date.now() - 60_000),
    });
    await store.deleteExpired();
    expect(await total("request")).toBe(1);
    await store.put(
      "code",
      "approved-code",
      { clientId: "client" },
      future(),
      "live-request",
    );
    expect(await store.consume("code", "approved-code")).toEqual({
      clientId: "client",
    });
  });

  it("stores by kind and consumes exactly once", async () => {
    const payload = { clientId: "client", userId: "user" };
    await store.put("code", "code", payload, future());
    expect(await store.get("client", "code")).toBeNull();
    expect(await store.get("code", "code")).toEqual(payload);
    expect(await store.consume("code", "code")).toEqual(payload);
    expect(await store.consume("code", "code")).toBeNull();
  });

  it("refuses an oversized payload or key", async () => {
    await expect(
      store.put("client", "big", { blob: "x".repeat(33 * 1024) }, future()),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      store.put("client", "k".repeat(129), {}, future()),
    ).rejects.toMatchObject({ status: 413 });
    expect(await total("client")).toBe(0);
  });

  it("bounds each cleanup batch, including registration-only traffic", async () => {
    await seed("client", EXPIRED_STATE_BATCH * 2 + 1, true);
    expect(await store.get("client", "client-1")).toBeNull();
    await store.deleteExpired();
    expect(await total("client")).toBe(EXPIRED_STATE_BATCH + 1);
    await store.put("client", "fresh", {}, future());
    expect(await total("client")).toBe(2);
  });

  it("commits bounded cleanup even when a legacy over-cap table denies the insert", async () => {
    await seed(
      "client",
      OAUTH_STATE_LIMITS.client.rows + EXPIRED_STATE_BATCH * 2,
      true,
    );
    await expect(store.put("client", "denied", {}, future())).rejects.toMatchObject({
      status: 429,
    });
    expect(await total("client")).toBe(
      OAUTH_STATE_LIMITS.client.rows + EXPIRED_STATE_BATCH,
    );
    await expect(store.put("client", "denied", {}, future())).rejects.toMatchObject({
      status: 429,
    });
    expect(await total("client")).toBe(OAUTH_STATE_LIMITS.client.rows);
    await expect(
      store.put("client", "accepted", {}, future()),
    ).resolves.toBeUndefined();
  });

  it.each(["client", "request", "code"] as const)(
    "enforces the real global %s cap atomically under parallel attempts without evicting live state",
    async (kind) => {
      const limit = OAUTH_STATE_LIMITS[kind].rows;
      await seed(kind, limit - 1);
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) =>
          store.put(
            kind,
            `new-${index}`,
            { clientId: `new-client-${index}` },
            future(),
          ),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({ status: 429 });
      expect(await total(kind)).toBe(limit);
      expect(await store.get(kind, `${kind}-1`)).toEqual({
        clientId: "seed-client",
      });
    },
  );

  it("limits outstanding state per client while allowing another client", async () => {
    await seed("request", OAUTH_STATE_LIMITS.request.perClient);
    await expect(
      store.put("request", "denied", { clientId: "seed-client" }, future()),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      store.put("request", "other", { clientId: "other-client" }, future()),
    ).resolves.toBeUndefined();
    expect(await total("request")).toBe(
      OAUTH_STATE_LIMITS.request.perClient + 1,
    );
  });

  it("enforces durable registration rate limits and reuses one counter after its window expires", async () => {
    await saturateRate("client");
    await expect(store.put("client", "denied", {}, future())).rejects.toMatchObject({
      status: 429,
    });
    expect(await total("client")).toBe(0);
    await app.db.update(
      McpOauthStateEntity,
      { kind: "rate" },
      { expiresAt: new Date(0) },
    );
    await store.put("client", "allowed", {}, future());
    expect(await total("rate")).toBe(1);
    expect(await total("client")).toBe(1);
    const [rate] = await app.db.find(McpOauthStateEntity, {
      where: { kind: "rate" },
    });
    expect(rate?.payload).toEqual({ count: 1 });
    expect(rate?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps a consent request on code quota failure and atomically consumes it on success", async () => {
    await store.put("request", "consent", { clientId: "client" }, future());
    await saturateRate("code");
    await expect(
      store.put("code", "denied", { clientId: "client" }, future(), "consent"),
    ).rejects.toMatchObject({ status: 429 });
    expect(await store.get("request", "consent")).not.toBeNull();
    await app.db.delete(McpOauthStateEntity, { kind: "rate", key: "code" });
    await store.put("code", "issued", { clientId: "client" }, future(), "consent");
    expect(await store.get("request", "consent")).toBeNull();
    await expect(
      store.put("code", "replayed", { clientId: "client" }, future(), "consent"),
    ).rejects.toMatchObject({ status: 404 });
    expect(await total("code")).toBe(1);
  });

  it("issues only one code when multiple replicas approve the same consent", async () => {
    await store.put("request", "race", { clientId: "client" }, future());
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        store.put("code", `code-${index}`, { clientId: "client" }, future(), "race"),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await total("code")).toBe(1);
    expect(await store.get("request", "race")).toBeNull();
  });
});
