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
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;
// Authenticates real API keys, like the previous test's unmocked session.
let keyApp: TestApp;

beforeAll(async () => {
  app = await createTestApp();
  keyApp = await createTestApp({ realAuth: true });
});

afterAll(async () => {
  await app.close();
  await keyApp.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
});

async function fixture(role = "admin") {
  const member = await createWorkspaceMember(app.db, { role });
  const { project, columns } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "Private task",
    number: 1,
    status: "to-do",
    columnId: columns.todo.id,
  });
  const field = await insertRow(app.db, CustomFieldDefinitionEntity, {
    projectId: project.id,
    name: "Private field",
    type: "text",
    required: false,
    defaultValue: "private-default",
    position: 0,
  });
  await insertRow(app.db, CustomFieldValueEntity, {
    taskId: task.id,
    fieldId: field.id,
    value: "private-value",
  });
  return {
    member,
    project,
    task,
    paths: [
      `/api/custom-field/project/${project.id}`,
      `/api/custom-field/project/${project.id}/values`,
      `/api/custom-field/task/${task.id}`,
      `/api/custom-field/project/${project.id}/filter-values`,
    ],
  };
}

describe("custom field read authorization", () => {
  for (const authentication of ["api-key", "custom-role"] as const) {
    it.each([
      [{}, [403, 403, 403, 403]],
      [{ project: ["read"] }, [200, 403, 403, 403]],
      [{ task: ["read"] }, [403, 200, 200, 200]],
      [{ project: ["read"], task: ["read"] }, [200, 200, 200, 200]],
    ] as [Record<string, string[]>, number[]][])(
      `${authentication} respects permission map %j`,
      async (permissions, expected) => {
        const { member, paths } = await fixture(
          authentication === "custom-role" ? "limited" : "admin",
        );
        const headers: Record<string, string> = {};
        let client = app;
        if (authentication === "custom-role") {
          await addWorkspaceRole(
            app.db,
            member.workspace.id,
            "limited",
            permissions,
          );
          app.auth.signIn(member.user);
        } else {
          const { key } = await seedApiKey(app.db, member.user.id, {
            name: "scoped test key",
            permissions: JSON.stringify(permissions),
            enabled: true,
          });
          headers.Authorization = `Bearer ${key}`;
          client = keyApp;
        }
        for (const [i, path] of paths.entries()) {
          const response = await client.request(path, { headers });
          expect(response.status, path).toBe(expected[i]);
          const body = await response.text();
          if (expected[i] === 403) {
            expect(body).not.toContain("private-default");
            expect(body).not.toContain("private-value");
            expect(body).not.toContain("Private field");
          } else {
            expect(body).toContain(
              i === 0 ? "private-default" : "private-value",
            );
          }
        }
      },
    );
  }

  it("does not let read scopes bypass workspace membership", async () => {
    const { paths } = await fixture();
    const outsider = await createWorkspaceMember(app.db, { role: "admin" });
    app.auth.signIn(outsider.user);
    for (const path of paths)
      expect((await app.request(path)).status).toBe(404);
  });
});

describe("date defaults", () => {
  it.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-02-30T12:00:00Z",
    "September 19, 2026",
  ])(
    "rejects invalid default %s without definition or backfill writes",
    async (defaultValue) => {
      const { member, project } = await fixture();
      app.auth.signIn(member.user);
      const response = await app.request("/api/custom-field", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          name: "Deadline",
          type: "date",
          required: true,
          defaultValue,
        }),
      });
      expect(response.status).toBe(400);
      expect(await app.db.find(CustomFieldDefinitionEntity)).toHaveLength(1);
      expect(await app.db.find(CustomFieldValueEntity)).toHaveLength(1);
    },
  );

  // The previous test also created a task through POST /api/task/{projectId}
  // and expected it to receive the default; that half waits for the task
  // routes (stream 1). This half checks the backfill of the existing task.
  it.each(["2028-02-29", "2028-02-29T12:00:00Z", " 2028-02-29 "])(
    "accepts %s and uses it for existing tasks",
    async (defaultValue) => {
      const { member, project, task } = await fixture();
      app.auth.signIn(member.user);
      // Fixtures inserted a task directly; synchronize its project counter.
      await app.db.update(
        ProjectEntity,
        { id: project.id },
        { lastTaskNumber: 1 },
      );
      const response = await app.request("/api/custom-field", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          name: "Deadline",
          type: "date",
          required: true,
          defaultValue,
        }),
      });
      expect(response.status).toBe(200);
      const field = (await response.json()) as {
        id: string;
        defaultValue: string;
      };
      expect(field.defaultValue).toBe(defaultValue.trim());
      const values = await app.db.find(CustomFieldValueEntity, {
        where: { fieldId: field.id },
      });
      expect(values).toEqual([
        expect.objectContaining({
          taskId: task.id,
          value: defaultValue.trim(),
        }),
      ]);
    },
  );

  it.skip("uses an accepted date default for newly created tasks: depends on POST /api/task/{projectId} (stream 1)", () => {});
});
