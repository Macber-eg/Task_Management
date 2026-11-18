import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UserEntity } from "../../src/database/entities/user.entity";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createUser } from "../support/fixtures/create-user";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type AdminUserList = {
  users: { id: string; name: string; email: string; banned: boolean }[];
  total: number;
};

describe("API integration: admin user listing", () => {
  let app: TestApp;

  async function listUsers(query: Record<string, string> = {}) {
    const search = new URLSearchParams(query).toString();
    return app.request(`/api/admin/users${search ? `?${search}` : ""}`);
  }

  const user = (overrides: Partial<UserEntity> & { name: string; email: string }) =>
    createUser(app.db, overrides);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    app.auth.signOut();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects users who are not instance administrators", async () => {
    app.auth.signIn(
      await user({ name: "Regular Member", email: "member@example.com" }),
    );
    expect((await listUsers()).status).toBe(403);
  });

  it("rejects API keys even when they belong to an administrator", async () => {
    const admin = await user({
      name: "Instance Admin",
      email: "admin@example.com",
      role: "admin",
    });
    app.auth.signInAs(await createApiKeyPrincipal(app.db, admin));
    expect((await listUsers()).status).toBe(403);
  });

  it("accepts administrators whose role list includes admin", async () => {
    const admin = await user({
      name: "Multi Role Admin",
      email: "multi@example.com",
      role: "user,admin",
    });
    app.auth.signIn(admin);

    const response = await listUsers();

    expect(response.status).toBe(200);
    const body = (await response.json()) as AdminUserList;
    expect(body.users.map((listed) => listed.id)).toEqual([admin.id]);
  });

  it("searches name and email case-insensitively", async () => {
    const admin = await user({
      name: "Instance Admin",
      email: "admin@example.com",
      role: "admin",
    });
    const alice = await user({ name: "Alice Wonder", email: "alice@example.com" });
    const bob = await user({ name: "Bob Builder", email: "bob@corp.io" });
    await user({ name: "Carol", email: "carol@example.com" });
    app.auth.signIn(admin);

    const byName = (await (
      await listUsers({ search: "ALICE" })
    ).json()) as AdminUserList;
    expect(byName.total).toBe(1);
    expect(byName.users.map((listed) => listed.id)).toEqual([alice.id]);

    const byEmail = (await (
      await listUsers({ search: "Corp" })
    ).json()) as AdminUserList;
    expect(byEmail.total).toBe(1);
    expect(byEmail.users.map((listed) => listed.id)).toEqual([bob.id]);

    const wildcard = (await (
      await listUsers({ search: "%" })
    ).json()) as AdminUserList;
    expect(wildcard.total).toBe(0);
    expect(wildcard.users).toEqual([]);
  });

  it("pages newest users first and reports the total across pages", async () => {
    const admin = await user({
      name: "Instance Admin",
      email: "admin@example.com",
      role: "admin",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const members: UserEntity[] = [];
    for (let index = 0; index < 4; index += 1) {
      members.push(
        await user({
          name: `Member ${index}`,
          email: `member-${index}@example.com`,
          createdAt: new Date(`2026-02-0${index + 1}T00:00:00Z`),
          banned: index === 3,
        }),
      );
    }
    app.auth.signIn(admin);

    const firstPage = (await (
      await listUsers({ limit: "2", page: "1" })
    ).json()) as AdminUserList;
    expect(firstPage.total).toBe(5);
    expect(firstPage.users.map((listed) => listed.id)).toEqual([
      members[3]?.id,
      members[2]?.id,
    ]);
    expect(firstPage.users[0]?.banned).toBe(true);
    expect(firstPage.users[1]?.banned).toBe(false);

    const lastPage = (await (
      await listUsers({ limit: "2", page: "3" })
    ).json()) as AdminUserList;
    expect(lastPage.total).toBe(5);
    expect(lastPage.users.map((listed) => listed.id)).toEqual([admin.id]);

    const beyond = (await (
      await listUsers({ limit: "2", page: "4" })
    ).json()) as AdminUserList;
    expect(beyond.users).toEqual([]);
    expect(beyond.total).toBe(5);
  });

  it("returns the previous API's user fields", async () => {
    const admin = await user({
      name: "Instance Admin",
      email: "admin@example.com",
      role: "admin",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      banExpires: new Date("2027-01-01T00:00:00Z"),
      banReason: "Spam",
      banned: true,
    });
    app.auth.signIn(admin);

    const body = (await (await listUsers()).json()) as AdminUserList;

    expect(body.users[0]).toEqual({
      id: admin.id,
      name: "Instance Admin",
      email: "admin@example.com",
      emailVerified: true,
      image: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: expect.any(String),
      role: "admin",
      banned: true,
      banReason: "Spam",
      banExpires: "2027-01-01T00:00:00.000Z",
    });
  });

  it("rejects invalid paging values", async () => {
    app.auth.signIn(
      await user({
        name: "Instance Admin",
        email: "admin@example.com",
        role: "admin",
      }),
    );

    expect((await listUsers({ page: "0" })).status).toBe(400);
    expect((await listUsers({ limit: "101" })).status).toBe(400);
    expect((await listUsers({ limit: "abc" })).status).toBe(400);
  });
});
