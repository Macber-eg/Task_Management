import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ApiKeyVerifier } from "../../src/auth/api-key/api-key-verifier";
import { hashApiKey } from "../../src/auth/api-key/hash-api-key";
import { ApikeyEntity } from "../../src/database/entities/apikey.entity";
import type { UserEntity } from "../../src/database/entities/user.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const DAY = 24 * 60 * 60;

type KeyBody = Record<string, unknown> & { id: string; key: string };
type ListBody = {
  apiKeys: Record<string, unknown>[];
  total: number;
  limit?: number;
  offset?: number;
};

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Not ported: the previous suite left these endpoints to the library that
// served them. The expectations were taken from that library's responses.
describe("API integration: API key endpoints", () => {
  let app: TestApp;
  let user: UserEntity;

  const create = (body: unknown = {}) =>
    app.request("/api/auth/api-key/create", json(body));
  const update = (body: unknown) =>
    app.request("/api/auth/api-key/update", json(body));
  const remove = (body: unknown) =>
    app.request("/api/auth/api-key/delete", json(body));
  const list = (query = "") => app.request(`/api/auth/api-key/list${query}`);
  const get = (query: string) => app.request(`/api/auth/api-key/get${query}`);

  async function stored(id: string) {
    return app.db.findOne(ApikeyEntity, { where: { id } });
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    user = await createUser(app.db);
    app.auth.signIn(user);
  });

  describe("create", () => {
    it("returns the secret once and stores the key as the previous backend did", async () => {
      const before = Date.now();
      const response = await create({ name: "CI", expiresIn: 30 * DAY });
      const after = Date.now();

      expect(response.status).toBe(200);
      const body = (await response.json()) as KeyBody;
      expect(body).toEqual({
        id: expect.stringMatching(/^[a-zA-Z0-9]{32}$/),
        key: expect.stringMatching(/^[a-zA-Z]{64}$/),
        start: body.key.slice(0, 6),
        prefix: null,
        name: "CI",
        configId: "default",
        referenceId: user.id,
        enabled: true,
        rateLimitEnabled: true,
        rateLimitTimeWindow: 60_000,
        rateLimitMax: 100,
        requestCount: 0,
        remaining: null,
        refillAmount: null,
        refillInterval: null,
        lastRefillAt: null,
        lastRequest: null,
        expiresAt: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: body.createdAt,
        permissions: null,
        metadata: null,
      });
      const expiresAt = Date.parse(body.expiresAt as string);
      expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * DAY * 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 30 * DAY * 1000);

      expect(await stored(body.id)).toMatchObject({
        key: hashApiKey(body.key),
        configId: "default",
        referenceId: user.id,
        userId: null,
        start: body.start,
        metadata: "null",
        permissions: null,
        rateLimitMax: 100,
        rateLimitTimeWindow: 60_000,
        requestCount: 0,
      });

      expect(
        await app.get(ApiKeyVerifier).verify(body.key, { consume: true }),
      ).toMatchObject({
        status: "valid",
        key: { id: body.id, userId: user.id, permissions: null },
        rateLimit: { limit: 100, remaining: 99 },
      });
    });

    it("puts the prefix in front of the key and needs neither name nor expiry", async () => {
      const response = await create({ prefix: "kaneo_" });

      expect(response.status).toBe(200);
      const body = (await response.json()) as KeyBody;
      expect(body.key).toMatch(/^kaneo_[a-zA-Z]{64}$/);
      expect(body).toMatchObject({
        prefix: "kaneo_",
        start: "kaneo_",
        name: null,
        expiresAt: null,
      });
    });

    it.each([
      [{ permissions: { task: ["read"] } }, 400, "SERVER_ONLY_PROPERTY"],
      [{ remaining: 0 }, 400, "SERVER_ONLY_PROPERTY"],
      [{ refillAmount: 5, refillInterval: 1000 }, 400, "SERVER_ONLY_PROPERTY"],
      [{ rateLimitMax: 1_000_000 }, 400, "SERVER_ONLY_PROPERTY"],
      [{ rateLimitEnabled: false }, 400, "SERVER_ONLY_PROPERTY"],
      [{ userId: "someone-else" }, 401, "UNAUTHORIZED_SESSION"],
      [{ metadata: { team: "ops" } }, 400, "METADATA_DISABLED"],
      [{ expiresIn: 60 }, 400, "EXPIRES_IN_IS_TOO_SMALL"],
      [{ expiresIn: 366 * DAY }, 400, "EXPIRES_IN_IS_TOO_LARGE"],
      [{ prefix: "p".repeat(33) }, 400, "INVALID_PREFIX_LENGTH"],
      [{ name: "n".repeat(33) }, 400, "INVALID_NAME_LENGTH"],
    ])("refuses %j with %i %s", async (body, status, code) => {
      const response = await create(body);

      expect(response.status).toBe(status);
      expect((await readErrorBody(response)).code).toBe(code);
      expect(await app.db.count(ApikeyEntity)).toBe(0);
    });

    it("words the refusal of a server-only property as before", async () => {
      expect(await readErrorBody(await create({ rateLimitMax: 5 }))).toEqual({
        message:
          "The property you're trying to set can only be set from the server auth instance only.",
        code: "SERVER_ONLY_PROPERTY",
      });
    });

    it.each([
      [{ prefix: "a b" }, "body.prefix"],
      [{ expiresIn: 0 }, "body.expiresIn"],
      [{ name: 5 }, "body.name"],
    ])("reports the invalid body %j", async (body, path) => {
      const response = await create(body);

      expect(response.status).toBe(400);
      const error = await readErrorBody(response);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.issues?.map((issue) => issue.path)).toEqual([path]);
    });
  });

  describe("list", () => {
    it("returns only the caller's keys, without their hashes", async () => {
      const mine = await seedApiKey(app.db, user.id, { name: "mine" });
      const other = await createUser(app.db);
      await seedApiKey(app.db, other.id, { name: "theirs" });

      const response = await list();

      expect(response.status).toBe(200);
      const body = (await response.json()) as ListBody;
      expect(body).toEqual({
        apiKeys: [expect.objectContaining({ id: mine.row.id, name: "mine" })],
        total: 1,
      });
      expect(body.apiKeys[0]).not.toHaveProperty("key");
      expect(body.apiKeys[0]).not.toHaveProperty("userId");
      expect(body.apiKeys[0]).toMatchObject({
        referenceId: user.id,
        createdAt: mine.row.createdAt.toISOString(),
        permissions: null,
        metadata: null,
      });
    });

    it("sorts and pages, counting every match", async () => {
      const first = Date.now() - 60_000;
      for (const [index, name] of ["b", "c", "a"].entries()) {
        await seedApiKey(app.db, user.id, {
          name,
          createdAt: new Date(first + index),
        });
      }
      const names = async (query: string) => {
        const body = (await (await list(query)).json()) as ListBody;
        return { ...body, apiKeys: body.apiKeys.map((key) => key.name) };
      };

      expect(await names("")).toEqual({ apiKeys: ["b", "c", "a"], total: 3 });
      expect(await names("?sortBy=name")).toEqual({
        apiKeys: ["a", "b", "c"],
        total: 3,
      });
      expect(
        await names("?sortBy=name&sortDirection=desc&limit=1&offset=1"),
      ).toEqual({ apiKeys: ["b"], total: 3, limit: 1, offset: 1 });
      expect(await names("?configId=other")).toEqual({ apiKeys: [], total: 0 });
      expect(await names("?configId=default")).toMatchObject({ total: 3 });
    });

    it.each(["?limit=-1", "?offset=1.5", "?sortBy=nope", "?sortDirection=up"])(
      "rejects the query %s",
      async (query) => {
        const response = await list(query);

        expect(response.status).toBe(400);
        expect((await readErrorBody(response)).code).toBe("VALIDATION_ERROR");
      },
    );

    it("answers the workspace filter by the caller's standing there, with no keys", async () => {
      const { workspace, user: owner } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      await seedApiKey(app.db, owner.id);
      const query = `?organizationId=${workspace.id}`;

      const outsider = await list(query);
      expect(outsider.status).toBe(403);
      expect(await readErrorBody(outsider)).toEqual({
        message:
          "You are not a member of the organization that owns this API key.",
        code: "USER_NOT_MEMBER_OF_ORGANIZATION",
      });

      await addWorkspaceMember(app.db, workspace.id, user.id, "admin");
      const member = await list(query);
      expect(member.status).toBe(403);
      expect((await readErrorBody(member)).code).toBe(
        "INSUFFICIENT_API_KEY_PERMISSIONS",
      );

      app.auth.signIn(owner);
      const asOwner = await list(query);
      expect(asOwner.status).toBe(200);
      expect(await asOwner.json()).toEqual({ apiKeys: [], total: 0 });
    });
  });

  describe("get", () => {
    it("returns one of the caller's keys", async () => {
      const { row } = await seedApiKey(app.db, user.id, {
        name: "mine",
        permissions: JSON.stringify({ task: ["read"] }),
      });

      const response = await get(`?id=${row.id}`);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        id: row.id,
        name: "mine",
        permissions: { task: ["read"] },
        rateLimitMax: 10,
      });
      expect(body).not.toHaveProperty("key");
    });

    it("answers 404 for an unknown key and for someone else's", async () => {
      const other = await createUser(app.db);
      const theirs = await seedApiKey(app.db, other.id);

      for (const id of ["missing", theirs.row.id]) {
        const response = await get(`?id=${id}`);
        expect(response.status).toBe(404);
        expect(await readErrorBody(response)).toEqual({
          message: "API Key not found",
          code: "KEY_NOT_FOUND",
        });
      }
    });

    it("requires an id", async () => {
      const response = await get("");

      expect(response.status).toBe(400);
      expect((await readErrorBody(response)).code).toBe("VALIDATION_ERROR");
    });
  });

  describe("update", () => {
    it("renames, disables and removes the expiry without touching updatedAt", async () => {
      const { row } = await seedApiKey(app.db, user.id, {
        name: "old",
        expiresAt: new Date(Date.now() + 5 * DAY * 1000),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const response = await update({
        keyId: row.id,
        name: "new",
        enabled: false,
        expiresIn: null,
        // Ignored: metadata was switched off.
        metadata: { team: "ops" },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        id: row.id,
        name: "new",
        enabled: false,
        expiresAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        metadata: null,
      });
      expect(body).not.toHaveProperty("key");
      expect(await stored(row.id)).toMatchObject({
        name: "new",
        enabled: false,
        expiresAt: null,
        metadata: null,
        key: row.key,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
    });

    it("moves the expiry", async () => {
      const { row } = await seedApiKey(app.db, user.id);

      const before = Date.now();
      const response = await update({ keyId: row.id, expiresIn: 2 * DAY });

      expect(response.status).toBe(200);
      const expiresAt = (await stored(row.id))?.expiresAt?.getTime() ?? 0;
      expect(expiresAt).toBeGreaterThanOrEqual(before + 2 * DAY * 1000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 2 * DAY * 1000);
    });

    it.each([
      [{ remaining: 5 }, 400, "SERVER_ONLY_PROPERTY"],
      [{ permissions: null }, 400, "SERVER_ONLY_PROPERTY"],
      [{ permissions: { task: ["read"] } }, 400, "SERVER_ONLY_PROPERTY"],
      [{ rateLimitEnabled: false }, 400, "SERVER_ONLY_PROPERTY"],
      [{ userId: "someone-else", name: "x" }, 401, "UNAUTHORIZED_SESSION"],
      [{ name: "" }, 400, "INVALID_NAME_LENGTH"],
      [{ name: "n".repeat(33) }, 400, "INVALID_NAME_LENGTH"],
      [{ expiresIn: 5 }, 400, "EXPIRES_IN_IS_TOO_SMALL"],
      [{}, 400, "NO_VALUES_TO_UPDATE"],
      [{ metadata: { team: "ops" } }, 400, "NO_VALUES_TO_UPDATE"],
    ])("refuses %j with %i %s", async (changes, status, code) => {
      const { row } = await seedApiKey(app.db, user.id, { name: "kept" });

      const response = await update({ keyId: row.id, ...changes });

      expect(response.status).toBe(status);
      expect((await readErrorBody(response)).code).toBe(code);
      expect(await stored(row.id)).toEqual(row);
    });

    it("accepts the caller's own id as userId", async () => {
      const { row } = await seedApiKey(app.db, user.id);

      const response = await update({
        keyId: row.id,
        userId: user.id,
        name: "renamed",
      });

      expect(response.status).toBe(200);
    });

    it("answers 404 for an unknown key and for someone else's", async () => {
      const other = await createUser(app.db);
      const theirs = await seedApiKey(app.db, other.id, { name: "theirs" });

      for (const keyId of ["missing", theirs.row.id]) {
        const response = await update({ keyId, name: "taken" });
        expect(response.status).toBe(404);
        expect((await readErrorBody(response)).code).toBe("KEY_NOT_FOUND");
      }
      expect((await stored(theirs.row.id))?.name).toBe("theirs");
    });
  });

  describe("delete", () => {
    it("deletes the caller's key once", async () => {
      const { row } = await seedApiKey(app.db, user.id);

      const response = await remove({ keyId: row.id });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(await stored(row.id)).toBeNull();

      const again = await remove({ keyId: row.id });
      expect(again.status).toBe(404);
      expect((await readErrorBody(again)).code).toBe("KEY_NOT_FOUND");
    });

    it("answers 404 for someone else's key and leaves it", async () => {
      const other = await createUser(app.db);
      const theirs = await seedApiKey(app.db, other.id);

      const response = await remove({ keyId: theirs.row.id });

      expect(response.status).toBe(404);
      expect(await stored(theirs.row.id)).not.toBeNull();
    });

    it("requires a key id", async () => {
      const response = await remove({});

      expect(response.status).toBe(400);
      expect((await readErrorBody(response)).code).toBe("VALIDATION_ERROR");
    });

    it("refuses a caller whose banned flag is set, even after the ban ran out", async () => {
      const banned = await createUser(app.db, {
        banned: true,
        banExpires: new Date(Date.now() - 60_000),
      });
      const { row } = await seedApiKey(app.db, banned.id);
      app.auth.signIn(banned);

      const response = await remove({ keyId: row.id });

      expect(response.status).toBe(401);
      expect(await readErrorBody(response)).toEqual({
        message: "User is banned",
        code: "USER_BANNED",
      });
      expect(await stored(row.id)).not.toBeNull();
    });
  });

  it("answers 401 to a caller without credentials", async () => {
    const { row } = await seedApiKey(app.db, user.id);
    app.auth.signOut();

    for (const response of [
      await create({ name: "x" }),
      await list(),
      await get(`?id=${row.id}`),
      await update({ keyId: row.id, name: "x" }),
      await remove({ keyId: row.id }),
    ]) {
      expect(response.status).toBe(401);
      expect(await readErrorBody(response)).toEqual({
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    }
    expect(await app.db.count(ApikeyEntity)).toBe(1);
  });

  describe("called with an API key", () => {
    async function signInWithKey(owner: UserEntity) {
      const calling = await seedApiKey(app.db, owner.id, { name: "calling" });
      app.auth.signInAs({
        userId: owner.id,
        userEmail: "",
        user: null,
        session: null,
        apiKey: {
          id: calling.row.id,
          userId: owner.id,
          enabled: true,
          permissions: { task: ["read"] },
        },
      });
      return calling;
    }

    it("manages the owner's keys as the owner would", async () => {
      const calling = await signInWithKey(user);

      const created = await create({ name: "minted" });
      expect(created.status).toBe(200);
      const minted = (await created.json()) as KeyBody;
      expect(minted).toMatchObject({ referenceId: user.id, permissions: null });

      const listed = (await (await list("?sortBy=name")).json()) as ListBody;
      expect(listed.apiKeys.map((key) => key.id)).toEqual([
        calling.row.id,
        minted.id,
      ]);

      expect((await get(`?id=${minted.id}`)).status).toBe(200);
      expect((await update({ keyId: minted.id, name: "kept" })).status).toBe(
        200,
      );
      expect((await remove({ keyId: minted.id })).status).toBe(200);
      expect(await stored(minted.id)).toBeNull();
    });

    it("refuses to delete for an owner whose banned flag is set", async () => {
      const owner = await createUser(app.db, {
        banned: true,
        banExpires: new Date(Date.now() - 60_000),
      });
      const calling = await signInWithKey(owner);

      const response = await remove({ keyId: calling.row.id });

      expect(response.status).toBe(401);
      expect((await readErrorBody(response)).code).toBe("USER_BANNED");
    });
  });

  it("sweeps expired keys after answering, at most once every ten seconds", async () => {
    // Its own application: the sweep's ten second pause is per process.
    const fresh = await createTestApp();
    try {
      fresh.auth.signIn(user);
      const other = await createUser(fresh.db);
      const expired = { expiresAt: new Date(Date.now() - 1_000) };
      const mine = await seedApiKey(fresh.db, user.id, expired);
      await seedApiKey(fresh.db, other.id, expired);
      const live = await seedApiKey(fresh.db, other.id, {
        expiresAt: new Date(Date.now() + 60_000),
      });
      const forever = await seedApiKey(fresh.db, other.id);
      const remaining = async () =>
        (await fresh.db.find(ApikeyEntity)).map((apiKey) => apiKey.id).sort();

      const listed = (await (
        await fresh.request("/api/auth/api-key/list")
      ).json()) as ListBody;
      expect(listed.apiKeys.map((key) => key.id)).toEqual([mine.row.id]);
      await vi.waitFor(async () =>
        expect(await remaining()).toEqual([live.row.id, forever.row.id].sort()),
      );

      const late = await seedApiKey(fresh.db, user.id, expired);
      const again = (await (
        await fresh.request("/api/auth/api-key/list")
      ).json()) as ListBody;
      expect(again.apiKeys.map((key) => key.id)).toEqual([late.row.id]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await remaining()).toContain(late.row.id);
    } finally {
      await fresh.close();
    }
  });

  it("sends no rate limit headers to a session caller", async () => {
    const response = await list();

    expect(response.status).toBe(200);
    for (const header of [
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
      "retry-after",
    ]) {
      expect(response.headers.get(header)).toBeNull();
    }
  });
});
