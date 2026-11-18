import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: board columns", () => {
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

  async function adminProject(role = "admin") {
    const member = await createWorkspaceMember(app.db, { role });
    const fixture = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);
    return { ...member, ...fixture };
  }

  function createColumn(projectId: string, body: Record<string, unknown>) {
    return app.request(`/api/column/${projectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("lists a project's columns by position", async () => {
    const { project } = await adminProject("member");
    const response = await app.request(`/api/column/${project.id}`);
    expect(response.status).toBe(200);
    const columns = (await response.json()) as ColumnEntity[];
    expect(columns.map((column) => column.slug)).toEqual([
      "to-do",
      "in-progress",
      "in-review",
      "done",
    ]);
  });

  it("appends a column with a slug derived from its name", async () => {
    const { project } = await adminProject();
    const response = await createColumn(project.id, {
      name: "В работе",
      icon: "",
      color: "#ff0000",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      projectId: project.id,
      name: "В работе",
      slug: "в-работе",
      position: 4,
      icon: null,
      color: "#ff0000",
      isFinal: false,
    });
  });

  it("refuses names without letters, reserved slugs and duplicates", async () => {
    const { project } = await adminProject();

    const empty = await createColumn(project.id, { name: "!!!" });
    expect(empty.status).toBe(400);
    expect(await readErrorBody(empty)).toMatchObject({
      message: "Column name must contain at least one alphanumeric character",
    });

    const reserved = await createColumn(project.id, { name: "Archived" });
    expect(reserved.status).toBe(409);
    expect(await readErrorBody(reserved)).toMatchObject({
      message: 'Column slug "archived" is reserved for virtual task statuses',
    });

    const duplicate = await createColumn(project.id, { name: "To Do" });
    expect(duplicate.status).toBe(409);
    expect(await readErrorBody(duplicate)).toMatchObject({
      message: 'Column with slug "to-do" already exists in this project',
    });
  });

  it("requires project:update to change columns", async () => {
    const { project, columns } = await adminProject("member");

    expect((await createColumn(project.id, { name: "QA" })).status).toBe(403);
    const update = await app.request(`/api/column/${columns.todo.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Backlog" }),
    });
    expect(update.status).toBe(403);
  });

  it("updates only the given fields and clears icon and color with null", async () => {
    const { columns } = await adminProject();
    await app.db.update(
      ColumnEntity,
      { id: columns.todo.id },
      { icon: "Circle", color: "#00ff00" },
    );

    const response = await app.request(`/api/column/${columns.todo.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ icon: null, color: null }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "To Do",
      slug: "to-do",
      icon: null,
      color: null,
    });
  });

  it("reorders columns and returns the board in its new order", async () => {
    const { project, columns } = await adminProject();
    const response = await app.request(`/api/column/reorder/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        columns: [
          { id: columns.done.id, position: 0 },
          { id: columns.todo.id, position: 3 },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const reordered = (await response.json()) as ColumnEntity[];
    expect(reordered[0]?.id).toBe(columns.done.id);
    expect(reordered.at(-1)?.id).toBe(columns.todo.id);
  });

  it("refuses to delete a column that still holds tasks", async () => {
    const { project, columns } = await adminProject();
    await createTask(app.db, {
      projectId: project.id,
      columnId: columns.todo.id,
    });

    const blocked = await app.request(`/api/column/${columns.todo.id}`, {
      method: "DELETE",
    });
    expect(blocked.status).toBe(409);
    expect(await readErrorBody(blocked)).toMatchObject({
      message:
        "Cannot delete column that contains tasks. Move or delete tasks first.",
    });

    const deleted = await app.request(`/api/column/${columns.inReview.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ id: columns.inReview.id });

    const missing = await app.request(`/api/column/${columns.inReview.id}`, {
      method: "DELETE",
    });
    expect(missing.status).toBe(404);
    expect(await readErrorBody(missing)).toMatchObject({
      message: "Column not found",
    });
  });
});
