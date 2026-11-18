import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectRecentAccessEntity } from "../../src/database/entities/project-recent-access.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type Row = Record<string, unknown> & { id: string };

describe("API integration: project home", () => {
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

  function send(path: string, method: string, body?: unknown) {
    return app.request(`/api/project-home${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("keeps each user's bookmarks to themselves", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);

    const created = await send(`/bookmarks/${project.id}`, "POST", {
      title: "  Spec  ",
      url: " https://example.com/spec ",
    });
    expect(created.status).toBe(200);
    const bookmark = (await created.json()) as Row;
    expect(bookmark).toMatchObject({
      projectId: project.id,
      userId: member.user.id,
      title: "Spec",
      url: "https://example.com/spec",
    });

    const updated = await send(`/bookmark/${bookmark.id}`, "PUT", {
      title: "Design",
      url: "https://example.com/design",
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ title: "Design" });

    const list = await send(`/bookmarks/${project.id}`, "GET");
    expect(((await list.json()) as Row[]).map((row) => row.id)).toEqual([
      bookmark.id,
    ]);

    // Another user cannot see or change the bookmark, even by id.
    app.auth.signIn(await createUser(app.db));
    const foreign = await send(`/bookmark/${bookmark.id}`, "DELETE");
    expect(foreign.status).toBe(404);
    expect(await readErrorBody(foreign)).toMatchObject({
      message: "Bookmark not found",
    });

    app.auth.signIn(member.user);
    expect((await send(`/bookmark/${bookmark.id}`, "DELETE")).status).toBe(200);
    expect(
      await (await send(`/bookmarks/${project.id}`, "GET")).json(),
    ).toEqual([]);
  });

  it("records recent items, newest first, and keeps at most 30", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);

    for (let index = 0; index < 32; index++) {
      const response = await send(`/recent/${project.id}`, "POST", {
        itemType: "task",
        itemId: `task-${index}`,
        title: `Task ${index}`,
      });
      expect(response.status).toBe(200);
    }
    const revisit = await send(`/recent/${project.id}`, "POST", {
      itemType: "task",
      itemId: "task-31",
      title: " Renamed ",
      parentLabel: "  ",
    });
    const recent = (await revisit.json()) as Row[];
    expect(recent).toHaveLength(12);
    expect(recent[0]).toMatchObject({
      itemId: "task-31",
      title: "Renamed",
      parentLabel: null,
    });
    expect(
      await app.db.count(ProjectRecentAccessEntity, {
        where: { projectId: project.id, userId: member.user.id },
      }),
    ).toBe(30);

    const invalid = await send(`/recent/${project.id}`, "POST", {
      itemType: "label",
      itemId: "x",
      title: "x",
    });
    expect(invalid.status).toBe(400);
  });

  it("lists recent assets and refuses projects outside the workspace", async () => {
    const member = await createWorkspaceMember(app.db);
    const stranger = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);
    const assets = await send(`/assets/${project.id}`, "GET");
    expect(assets.status).toBe(200);
    expect(await assets.json()).toEqual([]);

    app.auth.signIn(stranger.user);
    const response = await send(`/bookmarks/${project.id}`, "GET");
    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Project not found",
    });
  });
});
