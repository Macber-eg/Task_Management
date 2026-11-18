import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { CustomFieldDefinitionEntity } from "../../src/database/entities/custom-field-definition.entity";
import { CustomFieldValueEntity } from "../../src/database/entities/custom-field-value.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Not ported from the previous suite, which had no HTTP coverage for these
// routes: they pin the translated queries and response shapes.
describe("API integration: custom field routes", () => {
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

  function send(method: string, path: string, body?: unknown) {
    return app.request(`/api/custom-field${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  }

  async function seeded() {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    const other = await createTask(app.db, {
      projectId: project.id,
      number: 2,
    });
    const size = await insertRow(app.db, CustomFieldDefinitionEntity, {
      projectId: project.id,
      name: "Size",
      type: "dropdown",
      options: ["S", "M"],
      position: 2,
    });
    const notes = await insertRow(app.db, CustomFieldDefinitionEntity, {
      projectId: project.id,
      name: "Notes",
      type: "text",
      position: 1,
    });
    app.auth.signIn(member.user);
    return { ...member, project, task, other, size, notes };
  }

  it("lists definitions by position, project values and distinct filter values", async () => {
    const { project, task, other, size, notes } = await seeded();
    const sizeValue = await insertRow(app.db, CustomFieldValueEntity, {
      taskId: task.id,
      fieldId: size.id,
      value: "S",
    });
    await insertRow(app.db, CustomFieldValueEntity, {
      taskId: other.id,
      fieldId: size.id,
      value: "S",
    });
    await insertRow(app.db, CustomFieldValueEntity, {
      taskId: task.id,
      fieldId: notes.id,
      value: "",
    });

    const definitions = await send("GET", `/project/${project.id}`);
    expect(definitions.status).toBe(200);
    expect(await definitions.json()).toEqual([
      {
        id: notes.id,
        projectId: project.id,
        name: "Notes",
        type: "text",
        required: false,
        defaultValue: null,
        options: null,
        position: 1,
        createdAt: notes.createdAt.toISOString(),
        updatedAt: notes.updatedAt.toISOString(),
      },
      expect.objectContaining({ id: size.id, options: ["S", "M"] }),
    ]);

    const values = await send("GET", `/project/${project.id}/values`);
    expect(values.status).toBe(200);
    const body = (await values.json()) as { id: string }[];
    expect(body).toHaveLength(3);
    expect(body).toContainEqual({
      id: sizeValue.id,
      taskId: task.id,
      fieldId: size.id,
      value: "S",
      fieldName: "Size",
      fieldPosition: 2,
      fieldType: "dropdown",
      fieldOptions: ["S", "M"],
    });

    const filters = await send("GET", `/project/${project.id}/filter-values`);
    expect(filters.status).toBe(200);
    expect(
      ((await filters.json()) as { fieldId: string }[]).sort((a, b) =>
        a.fieldId.localeCompare(b.fieldId),
      ),
    ).toEqual(
      [
        {
          fieldId: size.id,
          fieldName: "Size",
          fieldType: "dropdown",
          values: ["S"],
        },
        {
          fieldId: notes.id,
          fieldName: "Notes",
          fieldType: "text",
          values: [],
        },
      ].sort((a, b) => a.fieldId.localeCompare(b.fieldId)),
    );
  });

  it("reorders fields and refuses a field of another project without changes", async () => {
    const { project, size, notes } = await seeded();
    const elsewhere = await createProjectFixture(app.db, {
      workspaceId: project.workspaceId,
    });
    const foreign = await insertRow(app.db, CustomFieldDefinitionEntity, {
      projectId: elsewhere.project.id,
      name: "Foreign",
      type: "text",
      position: 0,
    });

    const reordered = await send("PUT", `/reorder/${project.id}`, {
      fields: [
        { id: size.id, position: 0 },
        { id: notes.id, position: 5 },
      ],
    });
    expect(reordered.status).toBe(200);
    expect(
      ((await reordered.json()) as { id: string; position: number }[]).map(
        ({ id, position }) => ({ id, position }),
      ),
    ).toEqual([
      { id: size.id, position: 0 },
      { id: notes.id, position: 5 },
    ]);

    const refused = await send("PUT", `/reorder/${project.id}`, {
      fields: [
        { id: size.id, position: 9 },
        { id: foreign.id, position: 1 },
      ],
    });
    expect(refused.status).toBe(400);
    expect(await readErrorBody(refused)).toMatchObject({
      message: `Custom field ${foreign.id} does not belong to this project`,
    });
    const stored = await app.db.findOneByOrFail(CustomFieldDefinitionEntity, {
      id: size.id,
    });
    expect(stored.position).toBe(0);
  });

  it("appends a new field after the last position and backfills its default", async () => {
    const { project, task, other } = await seeded();
    const created = await send("POST", "", {
      projectId: project.id,
      name: "Size",
      type: "dropdown",
      options: ["S", "M"],
      defaultValue: "M",
    });
    expect(created.status).toBe(200);
    const field = (await created.json()) as { id: string; position: number };
    expect(field).toMatchObject({ position: 3, required: false });
    const values = await app.db.find(CustomFieldValueEntity, {
      where: { fieldId: field.id },
    });
    expect(values.map((value) => [value.taskId, value.value]).sort()).toEqual(
      [
        [task.id, "M"],
        [other.id, "M"],
      ].sort(),
    );

    const blank = await send("POST", "", {
      projectId: project.id,
      name: "  ",
      type: "text",
    });
    expect(blank.status).toBe(400);
    expect(await readErrorBody(blank)).toMatchObject({
      message: "Name cannot be empty",
    });
  });

  it("overwrites an existing value in place", async () => {
    const { task, notes } = await seeded();
    const first = await send("PUT", "/value", {
      taskId: task.id,
      fieldId: notes.id,
      value: " first ",
    });
    expect(first.status).toBe(200);
    const created = (await first.json()) as Record<string, unknown>;
    expect(created).toMatchObject({ taskId: task.id, value: "first" });

    const second = await send("PUT", "/value", {
      taskId: task.id,
      fieldId: notes.id,
      value: "second",
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      id: created.id,
      value: "second",
    });
    expect(await app.db.find(CustomFieldValueEntity)).toHaveLength(1);
  });

  it("deletes a field and answers it with its workspace", async () => {
    const { workspace, notes } = await seeded();
    const deleted = await send("DELETE", `/${notes.id}`);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      id: notes.id,
      name: "Notes",
      workspaceId: workspace.id,
    });
    expect(
      await app.db.findOneBy(CustomFieldDefinitionEntity, { id: notes.id }),
    ).toBeNull();

    const missing = await send("DELETE", `/${notes.id}`);
    expect(missing.status).toBe(404);
    expect(await readErrorBody(missing)).toMatchObject({
      message: "Custom field not found",
    });
  });
});
