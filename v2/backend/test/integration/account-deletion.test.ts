import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { AccountDataDeletionService } from "../../src/admin/account-deletion/account-data-deletion.service";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { TimeEntryEntity } from "../../src/database/entities/time-entry.entity";
import { UserAvatarEntity } from "../../src/database/entities/user-avatar.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { WorkspaceEntity } from "../../src/database/entities/workspace.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { signUpBrowser } from "../support/browser";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import {
  type RealtimeDouble,
  realtimeDouble,
  resetRealtimeDouble,
} from "../support/realtime-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const PASSWORD = "correct horse battery staple";

describe("account deletion", () => {
  let app: TestApp;
  let realtime: RealtimeDouble;

  const deleteAccountData = (userId: string) =>
    app.get(AccountDataDeletionService).deleteAccountData(userId);

  async function addMember(workspaceId: string, role: string) {
    const user = await createUser(app.db, { name: "Other Member" });
    await addWorkspaceMember(app.db, workspaceId, user.id, role);
    return user;
  }

  beforeAll(async () => {
    realtime = realtimeDouble();
    app = await createTestApp({
      realAuth: true,
      overrides: [[RealtimeConnections, realtime]],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    resetRealtimeDouble(realtime);
  });

  describe("account data", () => {
    it("deletes a workspace the account is the only member of", async () => {
      const owner = await createWorkspaceMember(app.db, { role: "owner" });
      await deleteAccountData(owner.user.id);
      expect(
        await app.db.findOneBy(WorkspaceEntity, { id: owner.workspace.id }),
      ).toBeNull();
    });

    it("revokes implicit administrators when deleting a sole-member workspace", async () => {
      const owner = await createWorkspaceMember(app.db, { role: "owner" });
      const admin = await createWorkspaceMember(app.db);
      await app.db.update(UserEntity, { id: admin.user.id }, { role: "user,admin" });

      await deleteAccountData(owner.user.id);

      for (const recipient of [owner.user.id, admin.user.id]) {
        expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
          recipient,
          owner.workspace.id,
          { force: true },
        );
      }
      expect(
        await app.db.findOneBy(WorkspaceEntity, { id: owner.workspace.id }),
      ).toBeNull();
      expect(
        await app.db.findOneBy(WorkspaceEntity, { id: admin.workspace.id }),
      ).not.toBeNull();
    });

    it("refuses to delete while the account is the only owner of a shared workspace", async () => {
      const owner = await createWorkspaceMember(app.db, {
        role: "owner",
        workspaceName: "Acme",
      });
      await addMember(owner.workspace.id, "member");

      await expect(deleteAccountData(owner.user.id)).rejects.toMatchObject({
        status: 409,
        code: "SOLE_WORKSPACE_OWNER",
        message:
          'You are the only owner of "Acme". Transfer ownership or delete it before deleting your account.',
      });
      expect(
        await app.db.findOneBy(WorkspaceEntity, { id: owner.workspace.id }),
      ).not.toBeNull();
    });

    it("revokes project sockets during account deletion", async () => {
      const owner = await createWorkspaceMember(app.db, { role: "owner" });
      const member = await addMember(owner.workspace.id, "member");

      await deleteAccountData(member.id);

      expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
        member.id,
        owner.workspace.id,
        { force: true },
      );
    });

    it("leaves a shared workspace that keeps another owner", async () => {
      const owner = await createWorkspaceMember(app.db, { role: "owner" });
      await addMember(owner.workspace.id, "owner");

      await deleteAccountData(owner.user.id);

      expect(
        await app.db.findOneBy(WorkspaceEntity, { id: owner.workspace.id }),
      ).not.toBeNull();
      expect(
        await app.db.countBy(WorkspaceUserEntity, { userId: owner.user.id }),
      ).toBe(0);
    });

    it("keeps tasks, time entries, and activity of another workspace after the user row is deleted", async () => {
      const host = await createWorkspaceMember(app.db, { role: "owner" });
      const guest = await addMember(host.workspace.id, "member");
      const { project } = await createProjectFixture(app.db, {
        workspaceId: host.workspace.id,
      });
      const task = await createTask(app.db, {
        projectId: project.id,
        userId: guest.id,
        title: "Assigned to the leaving user",
        priority: "medium",
        position: 1,
      });
      const timeEntry = await insertRow(app.db, TimeEntryEntity, {
        taskId: task.id,
        userId: guest.id,
        startTime: new Date(),
        duration: 60,
      });
      const activity = await insertRow(app.db, ActivityEntity, {
        taskId: task.id,
        userId: guest.id,
        type: "comment",
        content: "Worth keeping",
      });

      await deleteAccountData(guest.id);
      await app.db.delete(UserEntity, { id: guest.id });

      expect(await app.db.findOneByOrFail(TaskEntity, { id: task.id })).toMatchObject(
        { title: "Assigned to the leaving user", userId: null },
      );
      expect(
        await app.db.findOneByOrFail(TimeEntryEntity, { id: timeEntry.id }),
      ).toMatchObject({ duration: 60, userId: null });
      expect(
        await app.db.findOneByOrFail(ActivityEntity, { id: activity.id }),
      ).toMatchObject({ content: "Worth keeping", userId: null });
    });

    it("removes the stored avatar with the account", async () => {
      const member = await createWorkspaceMember(app.db, { role: "owner" });
      await insertRow(app.db, UserAvatarEntity, {
        userId: member.user.id,
        mimeType: "image/png",
        size: 8,
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      });

      await app.db.delete(UserEntity, { id: member.user.id });

      expect(
        await app.db.countBy(UserAvatarEntity, { userId: member.user.id }),
      ).toBe(0);
    });
  });

  describe("POST /api/auth/delete-user", () => {
    it("deletes the signed-in account after its data, signs out and revokes its sockets", async () => {
      const browser = await signUpBrowser(app, "admin@example.com");
      const { workspace } = await createWorkspaceMember(app.db);
      await addWorkspaceMember(app.db, workspace.id, browser.userId, "member");

      const response = await browser.post("/api/auth/delete-user", {});
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        message: "User deleted",
      });
      expect(await app.db.findOneBy(UserEntity, { id: browser.userId })).toBeNull();
      expect(await app.db.countBy(SessionEntity, { userId: browser.userId })).toBe(0);
      expect(realtime.revokeUserConnections).toHaveBeenCalledWith(browser.userId);
      expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
        browser.userId,
        workspace.id,
        { force: true },
      );
      expect(browser.jar.names()).not.toContain("kaneo.access_token");
      expect((await browser.get("/api/user/me")).status).toBe(401);
    });

    it("requires the password, or a login younger than a day", async () => {
      const browser = await signUpBrowser(app, "stale@example.com");
      await app.db.update(
        SessionEntity,
        { userId: browser.userId },
        { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      );

      const stale = await browser.post("/api/auth/delete-user", {});
      expect(stale.status).toBe(400);
      expect(await readErrorBody(stale)).toMatchObject({
        code: "SESSION_EXPIRED",
        message: "Session expired. Re-authenticate to perform this action.",
      });

      const wrong = await browser.post("/api/auth/delete-user", {
        password: "not the password",
      });
      expect(wrong.status).toBe(400);
      expect((await readErrorBody(wrong)).code).toBe("INVALID_PASSWORD");

      const accepted = await browser.post("/api/auth/delete-user", {
        password: PASSWORD,
      });
      expect(accepted.status).toBe(200);
      expect(await app.db.findOneBy(UserEntity, { id: browser.userId })).toBeNull();
    });

    it("refuses an unknown deletion token and a sole owner of a shared workspace", async () => {
      const browser = await signUpBrowser(app, "owner@example.com");
      const token = await browser.post("/api/auth/delete-user", {
        token: "never-issued",
      });
      expect(token.status).toBe(404);
      expect((await readErrorBody(token)).code).toBe("INVALID_TOKEN");

      const { workspace } = await createWorkspaceMember(app.db, {
        workspaceName: "Shared",
      });
      await app.db.update(
        WorkspaceUserEntity,
        { workspaceId: workspace.id },
        { role: "member" },
      );
      await addWorkspaceMember(app.db, workspace.id, browser.userId, "owner");
      const blocked = await browser.post("/api/auth/delete-user", {});
      expect(blocked.status).toBe(409);
      expect((await readErrorBody(blocked)).code).toBe("SOLE_WORKSPACE_OWNER");
      expect(await app.db.findOneBy(UserEntity, { id: browser.userId })).not.toBeNull();
    });

    it("needs a signed-in session", async () => {
      const response = await app.request("/api/auth/delete-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(401);
    });
  });
});
