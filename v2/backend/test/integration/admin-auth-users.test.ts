import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { WorkspaceEntity } from "../../src/database/entities/workspace.entity";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import {
  realtimeDouble,
  resetRealtimeDouble,
} from "../support/realtime-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: instance admin account endpoints", () => {
  const realtime = realtimeDouble();
  let app: TestApp;
  let admin: UserEntity;

  function post(path: string, body: unknown) {
    return app.request(`/api/auth/admin${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function loadUser(id: string) {
    return app.db.findOneBy(UserEntity, { id });
  }

  async function seedCredentials(userId: string) {
    const now = new Date();
    await insertRow(app.db, SessionEntity, {
      id: `session-${userId}`,
      token: `token-${userId}`,
      userId,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    await insertRow(app.db, AccountEntity, {
      accountId: userId,
      providerId: "credential",
      userId,
      password: "hashed",
    });
  }

  async function countRows(userId: string, workspaceId: string) {
    return {
      users: await app.db.countBy(UserEntity, { id: userId }),
      sessions: await app.db.countBy(SessionEntity, { userId }),
      accounts: await app.db.countBy(AccountEntity, { userId }),
      workspaces: await app.db.countBy(WorkspaceEntity, { id: workspaceId }),
    };
  }

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[RealtimeConnections, realtime]] });
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    resetRealtimeDouble(realtime);
    admin = await createUser(app.db, {
      name: "Instance Admin",
      email: "admin@example.com",
      role: "admin",
    });
    app.auth.signIn(admin);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("has-permission", () => {
    it("answers for the caller's own role", async () => {
      const response = await post("/has-permission", {
        permissions: { user: ["list"] },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ error: null, success: true });

      app.auth.signIn(await createUser(app.db, { role: "user" }));
      expect(
        await (
          await post("/has-permission", {
            permissions: { user: ["list"] },
            role: "admin",
          })
        ).json(),
      ).toEqual({ error: null, success: false });
    });

    it("refuses signed-out callers and API keys", async () => {
      app.auth.signOut();
      expect(
        (await post("/has-permission", { permissions: { user: ["list"] } }))
          .status,
      ).toBe(401);
      app.auth.signInAs(await createApiKeyPrincipal(app.db, admin));
      expect(
        (await post("/has-permission", { permissions: { user: ["list"] } }))
          .status,
      ).toBe(401);
    });

    it("requires permissions", async () => {
      expect(
        (await post("/has-permission", { permission: { user: ["list"] } }))
          .status,
      ).toBe(400);
      expect((await post("/has-permission", {})).status).toBe(400);
    });
  });

  describe("update-user email changes", () => {
    it("clears emailVerified when an administrator changes a user's email", async () => {
      const target = await createWorkspaceMember(app.db, { role: "member" });
      expect((await loadUser(target.user.id))?.emailVerified).toBe(true);

      const response = await post("/update-user", {
        userId: target.user.id,
        data: { email: "renamed@example.com" },
      });

      expect(response.status).toBe(200);
      expect(await loadUser(target.user.id)).toMatchObject({
        email: "renamed@example.com",
        emailVerified: false,
      });
    });

    it("keeps emailVerified when the submitted email only differs in case", async () => {
      const target = await createWorkspaceMember(app.db, { role: "member" });

      const response = await post("/update-user", {
        userId: target.user.id,
        data: { email: target.user.email.toUpperCase(), name: "Renamed Member" },
      });

      expect(response.status).toBe(200);
      expect(await loadUser(target.user.id)).toMatchObject({
        email: target.user.email,
        emailVerified: true,
        name: "Renamed Member",
      });
    });

    it("keeps emailVerified when the update does not touch the email", async () => {
      const target = await createWorkspaceMember(app.db, { role: "member" });

      const response = await post("/update-user", {
        userId: target.user.id,
        data: { name: "Renamed Member" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: target.user.id,
        name: "Renamed Member",
        email: target.user.email,
        role: null,
      });
      expect(await loadUser(target.user.id)).toMatchObject({
        emailVerified: true,
        name: "Renamed Member",
      });
    });

    it("rejects an address another account uses, and an invalid one", async () => {
      const target = await createUser(app.db);
      const taken = await post("/update-user", {
        userId: target.id,
        data: { email: admin.email },
      });
      expect(taken.status).toBe(400);
      expect(await taken.json()).toMatchObject({
        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      });
      const invalid = await post("/update-user", {
        userId: target.id,
        data: { email: "not an email" },
      });
      expect(await invalid.json()).toMatchObject({ code: "INVALID_EMAIL" });
    });

    it("refuses empty updates and passwords", async () => {
      const target = await createUser(app.db);
      expect(
        await (await post("/update-user", { userId: target.id, data: {} })).json(),
      ).toMatchObject({ code: "NO_DATA_TO_UPDATE" });
      expect(
        await (
          await post("/update-user", {
            userId: target.id,
            data: { password: "secret" },
          })
        ).json(),
      ).toMatchObject({ code: "PASSWORD_CANNOT_BE_UPDATED_VIA_UPDATE_USER" });
    });

    it("allows an admin to update their own profile without changing their role", async () => {
      const response = await post("/update-user", {
        userId: admin.id,
        data: { name: "Updated name" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ name: "Updated name" });
      expect((await loadUser(admin.id))?.role).toBe("admin");
    });

    it("refuses non-administrators", async () => {
      const target = await createUser(app.db);
      app.auth.signIn(await createUser(app.db, { role: "user" }));
      const response = await post("/update-user", {
        userId: target.id,
        data: { name: "Nope" },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS",
      });
    });
  });

  describe("ban-user and unban-user", () => {
    it("bans a user, ends their sessions and closes their sockets", async () => {
      const target = await createUser(app.db);
      await seedCredentials(target.id);

      const response = await post("/ban-user", {
        userId: target.id,
        banReason: "Deactivated by an instance administrator",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: {
          id: target.id,
          banned: true,
          banReason: "Deactivated by an instance administrator",
          banExpires: null,
        },
      });
      expect(await app.db.countBy(SessionEntity, { userId: target.id })).toBe(0);
      expect(realtime.revokeSessionConnections).toHaveBeenCalledWith(
        `session-${target.id}`,
      );
    });

    it("defaults the reason and sets an expiry when asked", async () => {
      const target = await createUser(app.db);
      const before = Date.now();
      const response = await post("/ban-user", {
        userId: target.id,
        banExpiresIn: 3600,
      });
      const { user } = (await response.json()) as {
        user: { banReason: string; banExpires: string };
      };
      expect(user.banReason).toBe("No reason");
      const expires = new Date(user.banExpires).getTime();
      expect(expires).toBeGreaterThanOrEqual(before + 3_599_000);
      expect(expires).toBeLessThanOrEqual(Date.now() + 3_601_000);
    });

    it("refuses to ban yourself or an unknown user", async () => {
      expect(
        await (await post("/ban-user", { userId: admin.id })).json(),
      ).toMatchObject({ code: "YOU_CANNOT_BAN_YOURSELF" });
      const missing = await post("/ban-user", { userId: "missing" });
      expect(missing.status).toBe(404);
    });

    it("lifts a ban", async () => {
      const target = await createUser(app.db, {
        banned: true,
        banReason: "Spam",
        banExpires: new Date("2030-01-01T00:00:00Z"),
      });

      const response = await post("/unban-user", { userId: target.id });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { id: target.id, banned: false, banReason: null, banExpires: null },
      });
    });

    it("refuses non-administrators", async () => {
      const target = await createUser(app.db);
      app.auth.signIn(await createUser(app.db, { role: "user" }));
      const response = await post("/ban-user", { userId: target.id });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "YOU_ARE_NOT_ALLOWED_TO_BAN_USERS",
      });
      expect((await loadUser(target.id))?.banned).toBe(false);
    });
  });

  describe("remove-user", () => {
    it("deletes the workspace a sole member owned together with the user", async () => {
      const target = await createWorkspaceMember(app.db, { role: "owner" });
      await seedCredentials(target.user.id);

      const response = await post("/remove-user", { userId: target.user.id });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      expect(await countRows(target.user.id, target.workspace.id)).toEqual({
        users: 0,
        sessions: 0,
        accounts: 0,
        workspaces: 0,
      });
      expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
        target.user.id,
        target.workspace.id,
        { force: true },
      );
      expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
        admin.id,
        target.workspace.id,
        { force: true },
      );
      expect(realtime.revokeUserConnections).toHaveBeenCalledWith(
        target.user.id,
      );
    });

    it("leaves a shared workspace that keeps another owner", async () => {
      const target = await createWorkspaceMember(app.db, { role: "owner" });
      const other = await createUser(app.db);
      await addWorkspaceMember(app.db, target.workspace.id, other.id, "owner");

      const response = await post("/remove-user", { userId: target.user.id });

      expect(response.status).toBe(200);
      expect(
        await app.db.countBy(WorkspaceUserEntity, {
          workspaceId: target.workspace.id,
        }),
      ).toBe(1);
      expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
        target.user.id,
        target.workspace.id,
        { force: true },
      );
    });

    it("refuses to remove the only owner of a shared workspace and keeps the account intact", async () => {
      const target = await createWorkspaceMember(app.db, {
        role: "owner",
        workspaceName: "Acme",
      });
      await addWorkspaceMember(
        app.db,
        target.workspace.id,
        (await createUser(app.db)).id,
        "member",
      );
      await seedCredentials(target.user.id);

      const response = await post("/remove-user", { userId: target.user.id });

      expect(response.status).toBe(409);
      const body = (await response.json()) as { message?: string; code?: string };
      expect(body.code).toBe("SOLE_WORKSPACE_OWNER");
      expect(body.message).toMatch(/only owner of "Acme"/);
      expect(await countRows(target.user.id, target.workspace.id)).toEqual({
        users: 1,
        sessions: 1,
        accounts: 1,
        workspaces: 1,
      });
    });

    it("rejects callers who are not instance administrators without touching data", async () => {
      const target = await createWorkspaceMember(app.db, { role: "owner" });
      await seedCredentials(target.user.id);
      app.auth.signIn(await createUser(app.db, { role: "user" }));

      const response = await post("/remove-user", { userId: target.user.id });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "INSTANCE_ADMIN_REQUIRED",
      });
      expect(await countRows(target.user.id, target.workspace.id)).toEqual({
        users: 1,
        sessions: 1,
        accounts: 1,
        workspaces: 1,
      });
    });

    it("rejects unauthenticated callers and API keys", async () => {
      const target = await createWorkspaceMember(app.db, { role: "owner" });
      app.auth.signOut();
      expect((await post("/remove-user", { userId: target.user.id })).status).toBe(
        403,
      );
      app.auth.signInAs(await createApiKeyPrincipal(app.db, admin));
      expect((await post("/remove-user", { userId: target.user.id })).status).toBe(
        403,
      );
      expect(await countRows(target.user.id, target.workspace.id)).toMatchObject({
        users: 1,
        workspaces: 1,
      });
    });

    it("does not let an administrator remove their own account through the admin endpoint", async () => {
      const response = await post("/remove-user", { userId: admin.id });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "CANNOT_REMOVE_YOURSELF",
      });
      expect(await app.db.countBy(UserEntity, { id: admin.id })).toBe(1);
    });

    it("answers 404 for an unknown user", async () => {
      const response = await post("/remove-user", { userId: "missing" });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "USER_NOT_FOUND" });
    });

    // The active-subscription refusal is covered in billing-delete-guard.test.ts.
  });
});
