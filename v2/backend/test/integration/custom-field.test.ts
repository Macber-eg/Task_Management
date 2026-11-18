import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { CustomFieldDefinitionEntity } from "../../src/database/entities/custom-field-definition.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Tasks the previous suite created through POST /api/task/{projectId} are
// inserted directly: the task routes belong to another stream, and these
// tests are about the custom field routes.
describe("custom fields API", () => {
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
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);
    return { member, project };
  }

  function send(method: string, path: string, body: unknown) {
    return app.request(`/api/custom-field${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function createField(body: Record<string, unknown>) {
    const response = await send("POST", "", body);
    const text = await response.text();
    expect(response.status, `Field creation failed: ${text}`).toBe(200);
    return JSON.parse(text) as { id: string } & Record<string, unknown>;
  }

  it("creates and retrieves a custom field for a project", async () => {
    const { project } = await createFixture();

    const field = await createField({
      projectId: project.id,
      name: "Priority score",
      type: "number",
      required: false,
    });

    expect(field).toMatchObject({
      projectId: project.id,
      name: "Priority score",
      type: "number",
      required: false,
      position: 1,
    });

    const listResponse = await app.request(
      `/api/custom-field/project/${project.id}`,
    );
    const listResponseBody = await listResponse.text();
    expect(listResponse.status, `List failed: ${listResponseBody}`).toBe(200);

    const fields = JSON.parse(listResponseBody) as { id: string }[];
    expect(fields).toHaveLength(1);
    expect(fields[0]?.id).toBe(field.id);
  });

  it("rejects an invalid default value for a number field", async () => {
    const { project } = await createFixture();

    const response = await send("POST", "", {
      projectId: project.id,
      name: "Score",
      type: "number",
      required: false,
      defaultValue: "not-a-number",
    });

    const body = await response.text();
    expect(response.status, body).toBe(400);
    expect(body).toContain("valid number");
  });

  it("requires options for a dropdown field", async () => {
    const { project } = await createFixture();

    const response = await send("POST", "", {
      projectId: project.id,
      name: "Environment",
      type: "dropdown",
      required: false,
    });

    const body = await response.text();
    expect(response.status, body).toBe(400);
    expect(body).toContain("at least one option");
  });

  it("rejects a dropdown field with an empty options array", async () => {
    const { project } = await createFixture();

    const response = await send("POST", "", {
      projectId: project.id,
      name: "Environment",
      type: "dropdown",
      required: false,
      options: [],
    });

    const body = await response.text();
    expect(response.status, body).toBe(400);
    expect(body).toContain("at least one option");
  });

  it("rejects a required field without a default value", async () => {
    const { project } = await createFixture();

    const response = await send("POST", "", {
      projectId: project.id,
      name: "Customer",
      type: "text",
      required: true,
    });

    const body = await response.text();
    expect(response.status, body).toBe(400);
    expect(body).toContain("default value");
  });

  it("sets and retrieves a custom field value for a task", async () => {
    const { project } = await createFixture();
    const field = await createField({
      projectId: project.id,
      name: "Score",
      type: "number",
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Task with custom field",
    });

    const valueResponse = await send("PUT", "/value", {
      taskId: task.id,
      fieldId: field.id,
      value: "42",
    });
    const valueBody = await valueResponse.text();
    expect(valueResponse.status, `Value set failed: ${valueBody}`).toBe(200);
    expect(JSON.parse(valueBody)).toMatchObject({
      taskId: task.id,
      fieldId: field.id,
      value: "42",
    });

    const getResponse = await app.request(`/api/custom-field/task/${task.id}`);
    const getBody = await getResponse.text();
    expect(getResponse.status, `Get values failed: ${getBody}`).toBe(200);
    expect(JSON.parse(getBody)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          fieldId: field.id,
          value: "42",
          fieldName: "Score",
          fieldType: "number",
        }),
      ]),
    );
  });

  it("rejects an invalid value according to the field type", async () => {
    const { project } = await createFixture();
    const field = await createField({
      projectId: project.id,
      name: "Completed",
      type: "boolean",
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Boolean field task",
    });

    const response = await send("PUT", "/value", {
      taskId: task.id,
      fieldId: field.id,
      value: "yes",
    });

    const body = await response.text();
    expect(response.status, body).toBe(400);
    expect(body).toContain("true or false");
  });

  it("rejects a field belonging to another project", async () => {
    const first = await createFixture();
    const secondMember = await createWorkspaceMember(app.db, {
      role: "admin",
    });
    const { project: secondProject } = await createProjectFixture(app.db, {
      workspaceId: secondMember.workspace.id,
    });

    const field = await createField({
      projectId: first.project.id,
      name: "Private field",
      type: "text",
    });

    app.auth.signIn(secondMember.user);
    const task = await createTask(app.db, {
      projectId: secondProject.id,
      title: "Task in another project",
    });

    const response = await send("PUT", "/value", {
      taskId: task.id,
      fieldId: field.id,
      value: "should fail",
    });

    const responseBody = await response.text();
    expect(response.status, responseBody).toBe(404);
    expect(responseBody).toContain("Custom field not found");
  });

  it("validates multiselect options", async () => {
    const { project } = await createFixture();

    for (const options of [undefined, [], ["only-one"]]) {
      const response = await send("POST", "", {
        projectId: project.id,
        name: "Tags",
        type: "multiselect",
        required: false,
        ...(options !== undefined ? { options } : {}),
      });

      const body = await response.text();
      expect(response.status, body).toBe(400);
      expect(body).toContain("at least 2 options");
    }
  });

  it("rejects invalid multiselect defaults before persisting the field", async () => {
    const { project } = await createFixture();

    for (const required of [false, true]) {
      const invalidDefaults = [
        "not-json",
        "{}",
        "null",
        '"frontend"',
        '["unknown"]',
        "[1]",
        "[{}]",
      ];
      if (required) invalidDefaults.push("[]");

      for (const defaultValue of invalidDefaults) {
        const response = await send("POST", "", {
          projectId: project.id,
          name: "Category",
          type: "multiselect",
          required,
          options: ["frontend", "backend"],
          defaultValue,
        });
        expect(response.status, await response.text()).toBe(400);
      }
    }

    expect(
      await app.db.find(CustomFieldDefinitionEntity, {
        where: { projectId: project.id },
      }),
    ).toEqual([]);
  });

  it.skip("validates optional multiselect task values while allowing empty selections: depends on POST /api/task/{projectId} (stream 1)", () => {});

  it("creates a multiselect field with options and applies its default to existing tasks", async () => {
    const { project } = await createFixture();
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Existing task",
    });
    const defaultValue = JSON.stringify(["frontend", "backend"]);

    const field = await createField({
      projectId: project.id,
      name: "Tags",
      type: "multiselect",
      required: false,
      options: ["frontend", "backend", "infra"],
      defaultValue,
    });

    const valuesResponse = await app.request(
      `/api/custom-field/task/${task.id}`,
    );
    const valuesBody = await valuesResponse.text();
    expect(valuesResponse.status, `Get values failed: ${valuesBody}`).toBe(200);
    expect(JSON.parse(valuesBody)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          fieldId: field.id,
          value: defaultValue,
          fieldType: "multiselect",
        }),
      ]),
    );
  });

  it.skip("creates a task with an explicit multiselect value: depends on POST /api/task/{projectId} (stream 1)", () => {});

  it.skip("uses the default for required fields and rejects an explicit empty value: depends on POST /api/task/{projectId} (stream 1)", () => {});

  it("updates, clears, and validates a multiselect value", async () => {
    const { project } = await createFixture();
    const field = await createField({
      projectId: project.id,
      name: "Tags",
      type: "multiselect",
      required: false,
      options: ["alpha", "beta", "gamma"],
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Multiselect task",
    });

    const updateValue = (value: string) =>
      send("PUT", "/value", { taskId: task.id, fieldId: field.id, value });

    const updateValueResponse = await updateValue(
      JSON.stringify(["beta", "gamma"]),
    );
    const updateValueBody = await updateValueResponse.text();
    expect(
      updateValueResponse.status,
      `Update failed: ${updateValueBody}`,
    ).toBe(200);

    const valuesResponse = await app.request(
      `/api/custom-field/task/${task.id}`,
    );
    const valuesBody = await valuesResponse.text();
    expect(valuesResponse.status, `Get values failed: ${valuesBody}`).toBe(200);
    expect(JSON.parse(valuesBody)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: field.id,
          value: JSON.stringify(["beta", "gamma"]),
          fieldType: "multiselect",
        }),
      ]),
    );

    const clearResponse = await updateValue("");
    const clearBody = await clearResponse.text();
    expect(clearResponse.status, `Clear failed: ${clearBody}`).toBe(200);

    const invalidJsonResponse = await updateValue("alpha");
    const invalidJsonBody = await invalidJsonResponse.text();
    expect(invalidJsonResponse.status, invalidJsonBody).toBe(400);
    expect(invalidJsonBody).toContain("JSON array");

    const invalidOptionResponse = await updateValue(
      JSON.stringify(["alpha", "unknown"]),
    );
    const invalidOptionBody = await invalidOptionResponse.text();
    expect(invalidOptionResponse.status, invalidOptionBody).toBe(400);
    expect(invalidOptionBody).toContain(
      "Invalid option(s) for this custom field",
    );
  });
});
