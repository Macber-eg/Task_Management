import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../support/fixtures/create-user";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: instance status", () => {
  let app: TestApp;

  async function getStatus() {
    const response = await app.request("/api/instance/status");
    expect(response.status).toBe(200);
    return (await response.json()) as unknown;
  }

  beforeAll(async () => {
    app = await createTestApp();
    app.auth.signOut();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("reports a fresh instance without credentials", async () => {
    expect(await getStatus()).toEqual({ hasUsers: false, hasAdmin: false });
  });

  it("reports an admin when the only one has a role list", async () => {
    await createUser(app.db, { role: "user" });
    await createUser(app.db, { role: "user,admin" });

    expect(await getStatus()).toEqual({ hasUsers: true, hasAdmin: true });
  });

  it("does not count administrator-like or padded roles", async () => {
    await createUser(app.db, { role: "administrator" });
    await createUser(app.db, { role: " admin , user" });
    await createUser(app.db, { role: "admin\t" });
    await createUser(app.db, { role: null });

    expect(await getStatus()).toEqual({ hasUsers: true, hasAdmin: false });
  });

  it("ignores historical anonymous rows", async () => {
    await createUser(app.db, { id: "old-guest", isAnonymous: true });

    expect(await getStatus()).toEqual({ hasUsers: false, hasAdmin: false });
  });
});
