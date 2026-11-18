import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { HTTPException } from "../../src/common/errors/http-exception";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { TaskEntitlements } from "../../src/task/seams/task-entitlements";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUnseededWorkspaceMember } from "../support/fixtures/task-d-unseeded-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous `billing-enforcement` suite checked that task creation answers
// 402 once a Kaneo Cloud plan has expired. How billing decides is the billing
// feature's; tasks only consult the `TaskEntitlements` seam, so this double
// stands for an expired workspace and the tests pin which task routes ask it,
// and that they ask only after access and permission checks pass.
const EXPIRED =
  "This workspace's Kaneo Cloud plan has expired. Subscribe to continue creating and editing.";

const entitlements = {
  requireWorkspaceEntitlement:
    vi.fn<TaskEntitlements["requireWorkspaceEntitlement"]>(),
} satisfies TaskEntitlements;

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp({ overrides: [[TaskEntitlements, entitlements]] });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  entitlements.requireWorkspaceEntitlement
    .mockReset()
    .mockRejectedValue(new HTTPException(402, { message: EXPIRED }));
});

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function memberWithTask(role = "owner") {
  const member = await createUnseededWorkspaceMember(app.db, role);
  const { project, columns } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "Billing gate task",
    priority: "low",
    status: "to-do",
    columnId: columns.todo.id,
    number: 1,
    position: 1,
  });
  // The seeded task holds number 1, so new tasks continue from 2.
  await app.db.update(ProjectEntity, { id: project.id }, { lastTaskNumber: 1 });
  app.auth.signIn(member.user);
  return { ...member, project, task };
}

const newTask = {
  title: "Billing gate task",
  description: "",
  priority: "low",
  status: "to-do",
};

describe("API integration: task entitlement checks", () => {
  it("blocks task creation with 402 when the workspace is not entitled", async () => {
    const { workspace, project } = await memberWithTask();

    const response = await app.request(
      `/api/task/${project.id}`,
      json("POST", newTask),
    );

    expect(response.status).toBe(402);
    expect(await readErrorBody(response)).toMatchObject({ message: EXPIRED });
    expect(entitlements.requireWorkspaceEntitlement).toHaveBeenCalledWith(
      workspace.id,
    );
    expect(
      await app.db.find(TaskEntity, { where: { projectId: project.id } }),
    ).toHaveLength(1);
  });

  it("allows task creation when the workspace is entitled", async () => {
    entitlements.requireWorkspaceEntitlement.mockResolvedValue(undefined);
    const { project } = await memberWithTask();

    const response = await app.request(
      `/api/task/${project.id}`,
      json("POST", newTask),
    );

    expect(response.status).toBe(200);
  });

  it("answers a missing permission before consulting the entitlement", async () => {
    const { project } = await memberWithTask("viewer");

    const response = await app.request(
      `/api/task/${project.id}`,
      json("POST", newTask),
    );

    expect(response.status).toBe(403);
    expect(entitlements.requireWorkspaceEntitlement).not.toHaveBeenCalled();
  });

  it.each([
    ["PUT", (id: string) => `/api/task/status/${id}`, { status: "done" }],
    ["PUT", (id: string) => `/api/task/priority/${id}`, { priority: "high" }],
    ["PUT", (id: string) => `/api/task/title/${id}`, { title: "Renamed" }],
    [
      "PUT",
      (id: string) => `/api/task/description/${id}`,
      { description: "x" },
    ],
    ["PUT", (id: string) => `/api/task/due-date/${id}`, {}],
    [
      "PUT",
      (id: string) => `/api/task/estimate/${id}`,
      { estimatedMinutes: 5 },
    ],
    ["PUT", (id: string) => `/api/task/assignee/${id}`, { userId: null }],
    ["POST", (id: string) => `/api/task/duplicate/${id}`, {}],
  ] as const)(
    "consults the entitlement on %s %s",
    async (method, path, body) => {
      const { task } = await memberWithTask();

      const response = await app.request(path(task.id), json(method, body));

      expect(response.status).toBe(402);
    },
  );

  it("does not consult the entitlement to delete or read a task", async () => {
    const { task } = await memberWithTask();

    expect((await app.request(`/api/task/${task.id}`)).status).toBe(200);
    expect(
      (await app.request(`/api/task/${task.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(entitlements.requireWorkspaceEntitlement).not.toHaveBeenCalled();
  });

  it.each(["delete", "removeLabel"] as const)(
    "lets bulk %s through without an entitlement",
    async (operation) => {
      const { task } = await memberWithTask();

      const response = await app.request(
        "/api/task/bulk",
        json("PATCH", {
          taskIds: [task.id],
          operation,
          ...(operation === "delete" ? {} : { value: "missing-label" }),
        }),
      );

      expect(response.status).not.toBe(402);
      expect(entitlements.requireWorkspaceEntitlement).not.toHaveBeenCalled();
    },
  );

  it("consults the entitlement for other bulk operations", async () => {
    const { task } = await memberWithTask();

    const response = await app.request(
      "/api/task/bulk",
      json("PATCH", {
        taskIds: [task.id],
        operation: "updatePriority",
        value: "high",
      }),
    );

    expect(response.status).toBe(402);
    expect(
      (await app.db.findOne(TaskEntity, { where: { id: task.id } }))?.priority,
    ).toBe("low");
  });
});
