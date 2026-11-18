import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { In } from "typeorm";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: project creation", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    app.auth.signOut();
  });

  it("rejects unauthenticated project creation requests", async () => {
    const response = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace-missing",
        name: "Unauthorized Project",
        icon: "Folder",
        slug: "unauthorized-project",
      }),
    });

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("creates a project for a workspace member and seeds default columns", async () => {
    const member = await createWorkspaceMember(app.db);
    app.auth.signIn(member.user);

    const response = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Roadmap",
        icon: "FolderKanban",
        slug: "roadmap",
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as ProjectEntity;

    expect(payload).toMatchObject({
      workspaceId: member.workspace.id,
      name: "Roadmap",
      icon: "FolderKanban",
      slug: "roadmap",
    });
    expect(payload).not.toHaveProperty("backgroundObjectKey");
    expect(payload).not.toHaveProperty("backgroundMimeType");

    const persistedProject = await app.db.findOne(ProjectEntity, {
      where: { id: payload.id },
    });

    expect(persistedProject).toMatchObject({
      id: payload.id,
      workspaceId: member.workspace.id,
      name: "Roadmap",
      slug: "roadmap",
    });

    const columns = await app.db.find(ColumnEntity, {
      where: { projectId: payload.id },
      order: { position: "ASC" },
    });

    expect(columns).toHaveLength(4);
    expect(columns.map((column) => column.slug)).toEqual([
      "to-do",
      "in-progress",
      "in-review",
      "done",
    ]);
    expect(columns.map((column) => column.isFinal)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("rejects project creation for users outside the workspace", async () => {
    const member = await createWorkspaceMember(app.db);
    const outsider = await createUser(app.db, {
      id: "user-outsider",
      name: "Outsider",
    });

    app.auth.signIn(outsider);

    const response = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Forbidden Project",
        icon: "Folder",
        slug: "forbidden-project",
      }),
    });

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Workspace not found",
      code: "NOT_FOUND",
    });
  });

  it("rejects a project key already used in the workspace", async () => {
    const member = await createWorkspaceMember(app.db);
    const other = await createWorkspaceMember(app.db);
    await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Kanban",
      slug: "KAN",
    });
    app.auth.signIn(member.user);
    const create = (workspaceId: string, slug: string) =>
      app.request("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: "New",
          icon: "Folder",
          slug,
        }),
      });

    const duplicate = await create(member.workspace.id, "kan");
    expect(duplicate.status).toBe(409);
    const duplicateError = await readErrorBody(duplicate);
    expect(duplicateError.code).toBe("CONFLICT");
    expect(duplicateError.message).toContain('"kan" (Kanban)');
    expect((await create(member.workspace.id, "ＫＡＮ")).status).toBe(409);

    app.auth.signIn(other.user);
    expect((await create(other.workspace.id, "KAN")).status).toBe(200);
  });

  it("rejects renaming a project to a key already used in the workspace", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Kanban",
      slug: "KAN",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Design",
      slug: "DES",
    });
    const { project: twin } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Design Twin",
      slug: "des",
    });
    app.auth.signIn(member.user);
    // The previous test omitted the required phase and sprint flags.
    const update = (id: string, name: string, slug: string) =>
      app.request(`/api/project/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          icon: "Folder",
          slug,
          description: "",
          isPublic: false,
          phasesEnabled: false,
          sprintsEnabled: false,
        }),
      });

    expect((await update(twin.id, "Design Twin Renamed", "des")).status).toBe(
      200,
    );
    expect((await update(project.id, "Design", "KAN")).status).toBe(409);
    expect((await update(project.id, "Design", "DSN")).status).toBe(200);
  });

  it("rejects unarchiving a project whose key another project uses", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Kanban",
      slug: "KAN",
    });
    const { project: archived } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "kan",
    });
    const { project: archivedTwin } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "OLD",
    });
    const { project: otherArchived } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "old",
    });
    const { project: uniqueArchived } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "NEW",
    });
    await app.db.update(
      ProjectEntity,
      {
        id: In([
          archived.id,
          archivedTwin.id,
          otherArchived.id,
          uniqueArchived.id,
        ]),
      },
      { archivedAt: new Date() },
    );
    app.auth.signIn(member.user);
    const unarchive = (id: string) =>
      app.request(`/api/project/${id}/unarchive`, { method: "PUT" });

    const conflict = await unarchive(archived.id);
    expect(conflict.status).toBe(409);
    await expect(conflict.text()).resolves.toContain("(Kanban)");
    expect((await unarchive(archivedTwin.id)).status).toBe(409);
    expect((await unarchive(uniqueArchived.id)).status).toBe(200);
  });
});
