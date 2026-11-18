import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CustomFieldDefinitionEntity } from "../../src/database/entities/custom-field-definition.entity";
import { CustomFieldValueEntity } from "../../src/database/entities/custom-field-value.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { insertRow } from "../support/fixtures/insert-row";
import { createUnseededWorkspaceMember } from "../support/fixtures/task-d-unseeded-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from the previous `custom-field` and `custom-field-security` suites:
// the cases that create tasks with custom field values. The field
// definitions are stored directly instead of through the custom field
// routes (another feature), and stored values are read from the database
// instead of `GET /api/custom-field/task/{id}`.
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

async function createFixture() {
  const member = await createUnseededWorkspaceMember(app.db, "admin");
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  app.auth.signIn(member.user);
  return { member, project };
}

function createField(
  projectId: string,
  values: Partial<CustomFieldDefinitionEntity> & { name: string; type: string },
) {
  return insertRow(app.db, CustomFieldDefinitionEntity, {
    projectId,
    required: false,
    position: 0,
    ...values,
  });
}

function createTaskRequest(
  projectId: string,
  body: Record<string, unknown> = {},
) {
  return app.request(`/api/task/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Custom field task",
      description: "",
      status: "to-do",
      priority: "no-priority",
      ...body,
    }),
  });
}

function valuesOf(taskId: string) {
  return app.db.find(CustomFieldValueEntity, { where: { taskId } });
}

describe("task creation with custom fields", () => {
  it("validates optional multiselect task values while allowing empty selections", async () => {
    const { project } = await createFixture();
    const field = await createField(project.id, {
      name: "Category",
      type: "multiselect",
      options: ["frontend", "backend"],
      defaultValue: "[]",
    });

    for (const value of [
      "not-json",
      "{}",
      "null",
      '"frontend"',
      '["unknown"]',
      "[1]",
      "[{}]",
    ]) {
      const response = await createTaskRequest(project.id, {
        title: "Invalid multiselect task",
        customFields: [{ fieldId: field.id, value }],
      });
      expect(response.status, await response.text()).toBe(400);
    }

    expect(
      await app.db.find(TaskEntity, { where: { projectId: project.id } }),
    ).toEqual([]);

    for (const value of ["", "[]", '["frontend"]']) {
      const response = await createTaskRequest(project.id, {
        title: "Valid multiselect task",
        customFields: [{ fieldId: field.id, value }],
      });
      expect(response.status, await response.text()).toBe(200);
    }
  });

  it("creates a task with an explicit multiselect value", async () => {
    const { project } = await createFixture();
    const field = await createField(project.id, {
      name: "Tags",
      type: "multiselect",
      options: ["frontend", "backend", "infra"],
    });
    const selectedValue = JSON.stringify(["infra"]);

    const taskResponse = await createTaskRequest(project.id, {
      title: "Task with multiselect",
      customFields: [{ fieldId: field.id, value: selectedValue }],
    });
    const taskBody = await taskResponse.text();
    expect(taskResponse.status, `Task creation failed: ${taskBody}`).toBe(200);
    const task = JSON.parse(taskBody) as { id: string };

    expect(await valuesOf(task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          fieldId: field.id,
          value: selectedValue,
        }),
      ]),
    );
  });

  it("uses the default for required fields and rejects an explicit empty value", async () => {
    const { project } = await createFixture();
    const defaultValue = JSON.stringify(["frontend"]);
    const field = await createField(project.id, {
      name: "Category",
      type: "multiselect",
      required: true,
      options: ["frontend", "backend"],
      defaultValue,
    });

    const defaultTaskResponse = await createTaskRequest(project.id, {
      title: "Task using default",
    });
    const defaultTaskBody = await defaultTaskResponse.text();
    expect(
      defaultTaskResponse.status,
      `Task creation failed: ${defaultTaskBody}`,
    ).toBe(200);
    const defaultTask = JSON.parse(defaultTaskBody) as { id: string };

    expect(await valuesOf(defaultTask.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: field.id, value: defaultValue }),
      ]),
    );

    const invalidTaskResponse = await createTaskRequest(project.id, {
      title: "Task with empty required value",
      customFields: [{ fieldId: field.id, value: "[]" }],
    });
    const invalidTaskBody = await invalidTaskResponse.text();
    expect(
      invalidTaskResponse.status,
      `Expected 400, got ${invalidTaskResponse.status}: ${invalidTaskBody}`,
    ).toBe(400);
    expect(invalidTaskBody).toContain("required");
  });

  // The previous case also created the field through its route, which trims
  // the default and backfills existing tasks; that part belongs to the custom
  // field feature. The stored (trimmed) default is what task creation reads.
  it.each(["2028-02-29", "2028-02-29T12:00:00Z", " 2028-02-29 "])(
    "uses the required date default %s for newly created tasks",
    async (defaultValue) => {
      const { project } = await createFixture();
      const field = await createField(project.id, {
        name: "Deadline",
        type: "date",
        required: true,
        defaultValue: defaultValue.trim(),
      });

      const created = await createTaskRequest(project.id, {
        title: "New task",
        priority: "low",
      });
      expect(created.status, await created.text()).toBe(200);

      const values = await app.db.find(CustomFieldValueEntity, {
        where: { fieldId: field.id },
      });
      expect(values).toHaveLength(1);
      expect(values.every((value) => value.value === defaultValue.trim())).toBe(
        true,
      );
    },
  );
});
