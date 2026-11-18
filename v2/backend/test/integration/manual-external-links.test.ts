import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { EventBus } from "../../src/events/event-bus";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("manual external resource links", () => {
  let app: TestApp;
  const published: { type: string; data: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    app
      .get(EventBus)
      .subscribe<Record<string, unknown>>("task.updated", async (data) => {
        published.push({ type: "task.updated", data });
      });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    published.length = 0;
  });

  async function context(role = "member") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Task",
      number: 1,
    });
    return { ...member, project, task };
  }

  function request(path: string, method: string, body?: unknown) {
    return app.request(`/api/external-link/task${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  }

  function link(
    taskId: string,
    integrationId: string | null = null,
    resourceType = "url",
  ) {
    return insertRow(app.db, ExternalLinkEntity, {
      taskId,
      integrationId,
      resourceType,
      externalId: "resource",
      url: "https://example.com/resource",
    });
  }

  it.skip("upgrades an existing integration link without changing it: a test of the previous Drizzle migration 0051, not of these routes", () => {});

  it.skip("lists a new manual link on the board: depends on the task board query (stream 1)", () => {});

  it("creates, lists and removes a manual link and publishes both updates", async () => {
    const own = await context();
    app.auth.signIn(own.user);
    const created = await request(`/${own.task.id}`, "POST", {
      url: "https://example.com/design",
      title: "Design",
    });
    expect(created.status).toBe(200);
    const entry = (await created.json()) as Record<string, unknown>;
    const stored = await app.db.findOneByOrFail(ExternalLinkEntity, {
      id: entry.id as string,
    });
    expect(entry).toEqual({
      id: stored.id,
      taskId: own.task.id,
      integrationId: null,
      resourceType: "url",
      externalId: "https://example.com/design",
      url: "https://example.com/design",
      title: "Design",
      metadata: null,
      createdAt: stored.createdAt.toISOString(),
      updatedAt: stored.updatedAt.toISOString(),
    });
    const listed = await request(`/${own.task.id}`, "GET");
    expect(await listed.json()).toMatchObject([
      { id: entry.id, integrationId: null, integration: null, title: "Design" },
    ]);
    expect(
      (await request(`/${own.task.id}/${String(entry.id)}`, "DELETE")).status,
    ).toBe(200);
    expect(await app.db.find(ExternalLinkEntity)).toHaveLength(0);
    expect(published).toHaveLength(2);
    expect(published.at(-1)).toEqual({
      type: "task.updated",
      data: expect.objectContaining({
        taskId: own.task.id,
        projectId: own.project.id,
        userId: own.user.id,
      }) as unknown,
    });
    expect(
      (await request(`/${own.task.id}/${String(entry.id)}`, "DELETE")).status,
    ).toBe(404);
    expect(published).toHaveLength(2);
  });

  // From the previous unit suite for createExternalLink.
  it("stores null when the title is omitted and announces the task update", async () => {
    const own = await context();
    app.auth.signIn(own.user);
    const created = await request(`/${own.task.id}`, "POST", {
      url: "https://example.com",
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      taskId: own.task.id,
      integrationId: null,
      resourceType: "url",
      externalId: "https://example.com",
      url: "https://example.com",
      title: null,
    });
    expect(published).toEqual([
      {
        type: "task.updated",
        data: {
          taskId: own.task.id,
          projectId: own.project.id,
          title: "Task",
          status: "to-do",
          userId: own.user.id,
          initiatorId: own.user.id,
        },
      },
    ]);
  });

  it.skip("answers 500 when the insert returns no row: only reachable by mocking the database", () => {});

  it("requires authentication for creation and removal", async () => {
    const own = await context();
    const entry = await link(own.task.id);
    app.auth.signOut();
    expect(
      (await request(`/${own.task.id}`, "POST", { url: "https://example.com" }))
        .status,
    ).toBe(401);
    expect(
      (await request(`/${own.task.id}/${entry.id}`, "DELETE")).status,
    ).toBe(401);
    expect(await app.db.find(ExternalLinkEntity)).toHaveLength(1);
  });

  it("allows viewers to read but not create or remove links", async () => {
    const own = await context("viewer");
    const entry = await link(own.task.id);
    app.auth.signIn(own.user);
    expect((await request(`/${own.task.id}`, "GET")).status).toBe(200);
    expect(
      (await request(`/${own.task.id}`, "POST", { url: "https://example.com" }))
        .status,
    ).toBe(403);
    expect(
      (await request(`/${own.task.id}/${entry.id}`, "DELETE")).status,
    ).toBe(403);
    expect(await app.db.find(ExternalLinkEntity)).toHaveLength(1);
    expect(published).toEqual([]);
  });

  it("rejects foreign workspace access and an authorized task paired with a foreign link", async () => {
    const own = await context();
    const other = await context();
    const entry = await link(other.task.id);
    app.auth.signIn(own.user);
    expect(
      (
        await request(`/${other.task.id}`, "POST", {
          url: "https://example.com",
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(`/${other.task.id}/${entry.id}`, "DELETE")).status,
    ).toBe(404);
    expect(
      (await request(`/${own.task.id}/${entry.id}`, "DELETE")).status,
    ).toBe(404);
    expect(await app.db.find(ExternalLinkEntity)).toHaveLength(1);
    expect(published).toEqual([]);
  });

  it("does not remove another task's link in the same workspace", async () => {
    const own = await context();
    const other = await createTask(app.db, {
      projectId: own.project.id,
      title: "Other",
      number: 2,
    });
    const entry = await link(other.id);
    app.auth.signIn(own.user);
    expect(
      (await request(`/${own.task.id}/${entry.id}`, "DELETE")).status,
    ).toBe(404);
    expect(await app.db.find(ExternalLinkEntity)).toHaveLength(1);
  });

  it("preserves provider-managed and non-URL links", async () => {
    const own = await context();
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: own.project.id,
      type: "github",
      config: "{}",
    });
    const entries = [
      await link(own.task.id, integration.id),
      await link(own.task.id, null, "issue"),
    ];
    app.auth.signIn(own.user);
    for (const entry of entries)
      expect(
        (await request(`/${own.task.id}/${entry.id}`, "DELETE")).status,
      ).toBe(404);
    expect(await app.db.find(ExternalLinkEntity)).toHaveLength(2);
    expect(published).toEqual([]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://example.com/file",
  ])("rejects unsafe URL %s", async (url) => {
    const own = await context();
    app.auth.signIn(own.user);
    expect((await request(`/${own.task.id}`, "POST", { url })).status).toBe(
      400,
    );
    expect(await app.db.find(ExternalLinkEntity)).toHaveLength(0);
    expect(published).toEqual([]);
  });
});
