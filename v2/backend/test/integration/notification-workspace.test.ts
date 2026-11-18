import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotificationEntity } from "../../src/database/entities/notification.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("workspace inbox", () => {
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

  async function fixture() {
    const member = await createWorkspaceMember(app.db);
    const other = await createWorkspaceMember(app.db);
    await addWorkspaceMember(
      app.db,
      other.workspace.id,
      member.user.id,
      "member",
    );
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      columnId: columns.todo.id,
      title: "Local task",
    });
    const local = await insertRow(app.db, NotificationEntity, {
      userId: member.user.id,
      resourceType: "task",
      resourceId: task.id,
      eventData: { workspaceId: other.workspace.id },
      createdAt: new Date(0),
    });
    const workspace = await insertRow(app.db, NotificationEntity, {
      userId: member.user.id,
      resourceType: "workspace",
      resourceId: member.workspace.id,
    });
    const foreign = await insertRow(app.db, NotificationEntity, {
      userId: member.user.id,
      resourceType: "workspace",
      resourceId: other.workspace.id,
    });
    const anotherUser = await insertRow(app.db, NotificationEntity, {
      userId: other.user.id,
      resourceType: "workspace",
      resourceId: member.workspace.id,
    });
    app.auth.signIn(member.user);
    return { member, other, local, workspace, foreign, anotherUser };
  }

  const allNotifications = () => app.db.find(NotificationEntity);

  it("filters by current resources before the limit and ignores forged event data", async () => {
    const { member, other, local, workspace } = await fixture();
    for (let index = 0; index < 60; index++) {
      await insertRow(app.db, NotificationEntity, {
        userId: member.user.id,
        resourceType: "workspace",
        resourceId: other.workspace.id,
      });
    }
    const response = await app.request(
      `/api/notification?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as Array<{ id: string }>).map((n) => n.id),
    ).toEqual([workspace.id, local.id]);
  });

  it("marks and clears only this user's notifications in the selected workspace", async () => {
    const { member, local, workspace, foreign, anotherUser } = await fixture();
    const query = `?workspaceId=${member.workspace.id}`;
    const marked = await app.request(`/api/notification/read-all${query}`, {
      method: "PATCH",
    });
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ success: true });
    const rows = await allNotifications();
    expect(
      rows
        .filter((n) => n.isRead)
        .map((n) => n.id)
        .sort(),
    ).toEqual([local.id, workspace.id].sort());
    const cleared = await app.request(`/api/notification/clear-all${query}`, {
      method: "DELETE",
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ success: true });
    expect((await allNotifications()).map((n) => n.id).sort()).toEqual(
      [foreign.id, anotherUser.id].sort(),
    );
  });

  it("keeps resource-less integration alerts accessible in workspace inboxes", async () => {
    const { member, other } = await fixture();
    const global = await insertRow(app.db, NotificationEntity, {
      userId: member.user.id,
      title: "Integration alert",
    });
    for (const workspaceId of [member.workspace.id, other.workspace.id]) {
      const response = await app.request(
        `/api/notification?workspaceId=${workspaceId}`,
      );
      expect(await response.json()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: global.id })]),
      );
    }
    await app.request(
      `/api/notification/read-all?workspaceId=${member.workspace.id}`,
      { method: "PATCH" },
    );
    expect(
      (await allNotifications()).find((n) => n.id === global.id)?.isRead,
    ).toBe(true);
    await app.request(
      `/api/notification/clear-all?workspaceId=${other.workspace.id}`,
      { method: "DELETE" },
    );
    expect((await allNotifications()).some((n) => n.id === global.id)).toBe(
      false,
    );
  });

  it("keeps the unscoped API compatible and rejects empty workspace filters", async () => {
    const { local, workspace, foreign } = await fixture();
    const response = await app.request("/api/notification");
    expect(
      ((await response.json()) as Array<{ id: string }>)
        .map((n) => n.id)
        .sort(),
    ).toEqual([local.id, workspace.id, foreign.id].sort());
    for (const [path, method] of [
      ["", "GET"],
      ["/read-all", "PATCH"],
      ["/clear-all", "DELETE"],
    ]) {
      expect(
        (await app.request(`/api/notification${path}?workspaceId=`, { method }))
          .status,
      ).toBe(400);
    }
  });
});
