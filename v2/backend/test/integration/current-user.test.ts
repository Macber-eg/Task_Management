import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserEntity } from "../../src/database/entities/user.entity";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GET /api/user/me", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("returns the signed-in user", async () => {
    await createWorkspaceMember(app.db, { userName: "Other user" });
    const { user } = await createWorkspaceMember(app.db, {
      userName: "Session owner",
    });
    app.auth.signIn(user);

    const response = await app.request("/api/user/me");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: user.id,
      name: "Session owner",
      email: user.email,
      image: null,
      role: null,
    });
  });

  it("returns the API-key owner without a session", async () => {
    await createWorkspaceMember(app.db, { userName: "Other user" });
    const { user } = await createWorkspaceMember(app.db, {
      userName: "Key owner",
    });
    app.auth.signInAs(await createApiKeyPrincipal(app.db, user));

    const response = await app.request("/api/user/me");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
    });
  });

  it("rejects missing credentials", async () => {
    app.auth.signOut();

    const response = await app.request("/api/user/me");

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  describe("with the real authenticator", () => {
    let real: TestApp;

    beforeAll(async () => {
      real = await createTestApp({ realAuth: true });
    });

    afterAll(async () => {
      await real.close();
    });

    it.each(["Authorization", "x-api-key"])(
      "rejects invalid credentials in %s",
      async (header) => {
        const response = await real.request("/api/user/me", {
          headers: {
            [header]:
              header === "Authorization" ? "Bearer invalid-key" : "invalid-key",
          },
        });

        expect(response.status).toBe(401);
        expect(await readErrorBody(response)).toMatchObject({
          message: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      },
    );

    it.each(["disabled", "expired"])("rejects a %s API key", async (state) => {
      const { user } = await createWorkspaceMember(real.db);
      const { key } = await seedApiKey(
        real.db,
        user.id,
        state === "disabled" ? { enabled: false } : { expiresAt: new Date(0) },
      );

      const response = await real.request("/api/user/me", {
        headers: { Authorization: `Bearer ${key}` },
      });

      expect(response.status).toBe(401);
      expect(await readErrorBody(response)).toMatchObject({
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    });
  });

  it("returns 404 when the authenticated user no longer exists", async () => {
    const { user } = await createWorkspaceMember(app.db);
    // Preserve the authenticated identity to simulate deletion before the lookup.
    app.auth.signIn(user);
    await app.db.delete(UserEntity, { id: user.id });

    const response = await app.request("/api/user/me");

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "User not found",
      code: "NOT_FOUND",
    });
  });
});
