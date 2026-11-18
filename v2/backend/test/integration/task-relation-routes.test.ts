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
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Not ported from the previous suite, which had no HTTP coverage for these
// cases: they pin the translated queries, errors and event payloads.
describe("API integration: task relation routes", () => {
  let app: TestApp;
  const published: { type: string; data: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    app
      .get(EventBus)
      .subscribe<Record<string, unknown>>(
        "task-relation.created",
        async (data) => {
          published.push({ type: "task-relation.created", data });
        },
      );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    published.length = 0;
  });

  function post(body: unknown) {
    return app.request("/api/task-relation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function seeded(role?: string) {
    const member = await createWorkspaceMember(app.db, { role });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const assignee = await createUser(app.db, { name: "Ada" });
    await addWorkspaceMember(app.db, member.workspace.id, assignee.id);
    const source = await createTask(app.db, {
      projectId: project.id,
      title: "Source",
      number: 1,
      status: "done",
      columnId: columns.done.id,
      priority: "high",
      userId: assignee.id,
    });
    const target = await createTask(app.db, {
      projectId: project.id,
      title: "Target",
      number: 2,
    });
    app.auth.signIn(member.user);
    return { ...member, project, source, target, assignee };
  }

  it("creates a relation, lists it with task summaries and announces it", async () => {
    const { user, project, source, target, assignee } = await seeded();

    const created = await post({
      sourceTaskId: source.id,
      targetTaskId: target.id,
      relationType: "blocks",
    });
    expect(created.status).toBe(200);
    const relation = (await created.json()) as Record<string, unknown>;
    const stored = await app.db.findOneByOrFail(TaskRelationEntity, {
      id: relation.id as string,
    });
    expect(relation).toEqual({
      id: stored.id,
      sourceTaskId: source.id,
      targetTaskId: target.id,
      relationType: "blocks",
      createdAt: stored.createdAt.toISOString(),
    });
    expect(published).toEqual([
      {
        type: "task-relation.created",
        data: {
          ...relation,
          createdAt: stored.createdAt,
          taskId: source.id,
          projectId: project.id,
          userId: user.id,
          initiatorId: user.id,
        },
      },
    ]);

    const listed = await app.request(`/api/task-relation/${target.id}`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      {
        ...relation,
        sourceTask: {
          id: source.id,
          title: "Source",
          status: "done",
          isCompleted: true,
          priority: "high",
          number: 1,
          projectId: project.id,
          userId: assignee.id,
          assigneeName: "Ada",
        },
        targetTask: {
          id: target.id,
          title: "Target",
          status: "to-do",
          isCompleted: false,
          priority: "low",
          number: 2,
          projectId: project.id,
          userId: null,
          assigneeName: null,
        },
      },
    ]);
  });

  it("refuses duplicates in either direction, self relations and a missing source", async () => {
    const { source, target } = await seeded();
    expect(
      (
        await post({
          sourceTaskId: source.id,
          targetTaskId: target.id,
          relationType: "related",
        })
      ).status,
    ).toBe(200);

    const duplicate = await post({
      sourceTaskId: target.id,
      targetTaskId: source.id,
      relationType: "related",
    });
    expect(duplicate.status).toBe(409);
    expect(await readErrorBody(duplicate)).toMatchObject({
      message: "This relation already exists",
    });

    const self = await post({
      sourceTaskId: source.id,
      targetTaskId: source.id,
      relationType: "blocks",
    });
    expect(self.status).toBe(400);
    expect(await readErrorBody(self)).toMatchObject({
      message: "Cannot create a relation between a task and itself",
    });

    const noSource = await post({
      targetTaskId: source.id,
      relationType: "blocks",
    });
    expect(noSource.status).toBe(400);
    expect(await readErrorBody(noSource)).toMatchObject({
      message: "sourceTaskId is required",
    });

    const unknownSource = await post({
      sourceTaskId: "missing",
      targetTaskId: source.id,
      relationType: "blocks",
    });
    expect(unknownSource.status).toBe(404);
    expect(await readErrorBody(unknownSource)).toMatchObject({
      message: "Source task not found",
    });

    expect(await app.db.find(TaskRelationEntity)).toHaveLength(1);
  });

  it("requires task:update to link or unlink tasks", async () => {
    const { workspace, source, target } = await seeded();
    const relation = await app.db.save(
      app.db.create(TaskRelationEntity, {
        id: "relation-1",
        sourceTaskId: source.id,
        targetTaskId: target.id,
        relationType: "blocks",
      }),
    );
    const viewer = await createUser(app.db);
    await addWorkspaceMember(app.db, workspace.id, viewer.id, "viewer");
    app.auth.signIn(viewer);

    expect(
      (
        await post({
          sourceTaskId: source.id,
          targetTaskId: target.id,
          relationType: "related",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/api/task-relation/${relation.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect((await app.request(`/api/task-relation/${source.id}`)).status).toBe(
      200,
    );
    expect(await app.db.find(TaskRelationEntity)).toHaveLength(1);

    const missing = await app.request("/api/task-relation/missing", {
      method: "DELETE",
    });
    expect(missing.status).toBe(404);
    expect(await readErrorBody(missing)).toMatchObject({
      message: "Task relation not found",
    });
  });
});
