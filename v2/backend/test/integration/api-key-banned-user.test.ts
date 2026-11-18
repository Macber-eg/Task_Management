import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiKeyVerifier } from "../../src/auth/api-key/api-key-verifier";
import { UserEntity } from "../../src/database/entities/user.entity";
import { CookieJar } from "../support/cookie-jar";
import { createUser } from "../support/fixtures/create-user";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: API keys of banned users", () => {
  let app: TestApp;
  let verifier: ApiKeyVerifier;

  async function createUserWithKey(
    ban: Partial<Pick<UserEntity, "banned" | "banExpires">>,
  ) {
    const user = await createUser(app.db, { name: "Key Owner", ...ban });
    const { key } = await seedApiKey(app.db, user.id, { enabled: true });
    return { userId: user.id, key };
  }

  async function ban(userId: string) {
    await app.db.update(UserEntity, { id: userId }, { banned: true });
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
    verifier = app.get(ApiKeyVerifier);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("accepts the key of a user who is not banned", async () => {
    const { userId, key } = await createUserWithKey({ banned: false });

    expect(await verifier.verify(key, { consume: true })).toMatchObject({
      key: { userId },
    });
  });

  it("accepts the key when the banned flag was never set", async () => {
    const { userId, key } = await createUserWithKey({ banned: null });

    expect(await verifier.verify(key, { consume: true })).toMatchObject({
      key: { userId },
    });
  });

  it("rejects the key of a banned user", async () => {
    const { key } = await createUserWithKey({ banned: true });

    expect(await verifier.verify(key, { consume: true })).toBeNull();
    expect(await verifier.verify(key, { consume: false })).toBeNull();
  });

  it("rejects the key while a temporary ban is still active", async () => {
    const { key } = await createUserWithKey({
      banned: true,
      banExpires: new Date(Date.now() + 60 * 60 * 1000),
    });

    expect(await verifier.verify(key, { consume: true })).toBeNull();
  });

  it("accepts the key once a temporary ban has expired", async () => {
    const { userId, key } = await createUserWithKey({
      banned: true,
      banExpires: new Date(Date.now() - 60 * 60 * 1000),
    });

    expect(await verifier.verify(key, { consume: true })).toMatchObject({
      key: { userId },
    });
  });

  describe("through the auth routes", () => {
    it("resolves a session for an active key and refuses it once banned", async () => {
      const { userId, key } = await createUserWithKey({ banned: false });
      const headers = { "x-api-key": key };

      const active = await app.request("/api/auth/get-session", { headers });
      expect(active.status).toBe(200);
      const body = (await active.json()) as { user?: { id: string } };
      expect(body.user?.id).toBe(userId);

      await ban(userId);

      const banned = await app.request("/api/auth/get-session", { headers });
      expect(banned.status).toBe(401);
    });

    it("does not let a browser cookie rescue a banned bearer key", async () => {
      const jar = new CookieJar();
      const signedUp = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Cookie Holder",
          email: "cookie-holder@example.com",
          password: "correct horse battery",
        }),
      });
      expect(signedUp.status).toBe(200);
      jar.store(signedUp);
      const path = "/api/auth/api-key/list";
      const cookie = jar.header(path);
      expect((await app.request(path, { headers: { cookie } })).status).toBe(
        200,
      );

      const { userId, key } = await createUserWithKey({ banned: false });
      await ban(userId);

      const response = await app.request(path, {
        headers: { authorization: `Bearer ${key}`, cookie },
      });

      expect(response.status).toBe(401);
    });

    it("applies the same rule to a bearer key on the API key endpoints", async () => {
      const { userId, key } = await createUserWithKey({ banned: false });
      const headers = { authorization: `Bearer ${key}` };

      const active = await app.request("/api/auth/api-key/list", { headers });
      expect(active.status).toBe(200);

      await ban(userId);

      const banned = await app.request("/api/auth/api-key/list", { headers });
      expect(banned.status).toBe(401);
      expect(await readErrorBody(banned)).toEqual({
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    });
  });
});
