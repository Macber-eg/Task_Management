import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { EventBus } from "../../src/events/event-bus";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("task relation tenant boundaries", () => {
  let app: TestApp;
  const published: { type: string; data: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    for (const type of ["task-relation.created", "task-relation.deleted"])
      app
        .get(EventBus)
        .subscribe<Record<string, unknown>>(type, async (data) => {
          published.push({ type, data });
        });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    published.length = 0;
  });

  async function context() {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Private title",
      number: 1,
    });
    return { ...member, task };
  }

  function request(path: string, method: string, body?: unknown) {
    return app.request(`/api/task-relation${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  }

  function seedRelation(sourceTaskId: string, targetTaskId: string) {
    return insertRow(app.db, TaskRelationEntity, {
      sourceTaskId,
      targetTaskId,
      relationType: "blocks",
    });
  }

  it("rejects a foreign target and a nonexistent target identically", async () => {
    const own = await context();
    const foreign = await context();
    app.auth.signIn(own.user);
    for (const targetTaskId of [foreign.task.id, "missing-task"]) {
      const response = await request("", "POST", {
        sourceTaskId: own.task.id,
        targetTaskId,
        relationType: "blocks",
      });
      expect(response.status).toBe(404);
      expect(await readErrorBody(response)).toMatchObject({
        message: "Target task not found",
        code: "NOT_FOUND",
      });
    }
    expect(await app.db.find(TaskRelationEntity)).toHaveLength(0);
    expect(published).toEqual([]);
  });

  it.each([false, true])(
    "hides legacy cross-workspace relations from reads in either direction (reverse=%s)",
    async (reverse) => {
      const own = await context();
      const foreign = await context();
      await seedRelation(
        reverse ? foreign.task.id : own.task.id,
        reverse ? own.task.id : foreign.task.id,
      );
      for (const member of [own, foreign]) {
        app.auth.signIn(member.user);
        const response = await request(`/${member.task.id}`, "GET");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
      }
    },
  );

  it("rejects deletion of a legacy foreign-target row without mutation or event", async () => {
    const own = await context();
    const foreign = await context();
    const relation = await seedRelation(own.task.id, foreign.task.id);
    app.auth.signIn(own.user);
    const response = await request(`/${relation.id}`, "DELETE");
    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Task relation not found",
      code: "NOT_FOUND",
    });
    expect(
      await app.db.findOne(TaskRelationEntity, { where: { id: relation.id } }),
    ).not.toBeNull();
    expect(published).toEqual([]);
  });

  it("requires source-workspace access for deletion even when the target is owned", async () => {
    const own = await context();
    const foreign = await context();
    const relation = await seedRelation(foreign.task.id, own.task.id);
    app.auth.signIn(own.user);
    const response = await request(`/${relation.id}`, "DELETE");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Task relation not found");
    expect(await app.db.find(TaskRelationEntity)).toHaveLength(1);
    expect(published).toEqual([]);
  });

  it("keeps same-workspace cross-project relations fully usable", async () => {
    const own = await context();
    const { project } = await createProjectFixture(app.db, {
      workspaceId: own.workspace.id,
    });
    const target = await createTask(app.db, {
      projectId: project.id,
      title: "Related",
      number: 1,
    });
    app.auth.signIn(own.user);
    const created = await request("", "POST", {
      sourceTaskId: own.task.id,
      targetTaskId: target.id,
      relationType: "related",
    });
    expect(created.status).toBe(200);
    const relation = (await created.json()) as { id: string };
    for (const task of [own.task, target]) {
      const response = await request(`/${task.id}`, "GET");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject([
        {
          id: relation.id,
          sourceTask: { id: own.task.id },
          targetTask: { id: target.id },
        },
      ]);
    }
    expect((await request(`/${relation.id}`, "DELETE")).status).toBe(200);
    expect(await app.db.find(TaskRelationEntity)).toHaveLength(0);
    expect(published).toContainEqual({
      type: "task-relation.deleted",
      data: expect.objectContaining({
        sourceTaskId: own.task.id,
        targetTaskId: target.id,
      }) as unknown,
    });
  });
});
