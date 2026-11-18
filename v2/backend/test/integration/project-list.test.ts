import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProjectEntity } from "../../src/database/entities/project.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type ProjectListEntry = ProjectEntity & {
  statistics: {
    completionPercentage: number;
    totalTasks: number;
    dueDate: string | null;
  };
  tasks?: unknown;
};

describe("API integration: project list payload", () => {
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

  async function seedTasks(
    projectId: string,
    tasks: { title: string; status: string; dueDate?: Date; number: number }[],
  ) {
    for (const task of tasks) {
      await createTask(app.db, {
        projectId,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate ?? null,
        number: task.number,
      });
    }
  }

  async function listProjects(workspaceId: string) {
    const response = await app.request(
      `/api/project?workspaceId=${workspaceId}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as ProjectListEntry[];
  }

  it("does not embed task rows in the project list response", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    await seedTasks(project.id, [
      { title: "First", status: "to-do", number: 1 },
      { title: "Second", status: "done", number: 2 },
      { title: "Third", status: "archived", number: 3 },
    ]);

    app.auth.signIn(member.user);
    const payload = await listProjects(member.workspace.id);
    expect(payload).toHaveLength(1);

    // The list is a summary view: task rows would grow it without bound.
    expect(payload[0]?.tasks).toBeUndefined();
    expect(payload[0]).toMatchObject({
      archivedTasks: [],
      plannedTasks: [],
      columns: [],
    });
    expect(payload[0]).not.toHaveProperty("backgroundObjectKey");
  });

  it("still reports accurate task statistics without embedding tasks", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    const earliest = new Date("2026-01-10T00:00:00.000Z");
    const later = new Date("2026-03-01T00:00:00.000Z");

    await seedTasks(project.id, [
      { title: "Open", status: "to-do", dueDate: later, number: 1 },
      { title: "Closed", status: "done", dueDate: earliest, number: 2 },
      { title: "Filed", status: "archived", number: 3 },
      { title: "Doing", status: "in-progress", number: 4 },
    ]);

    app.auth.signIn(member.user);
    const payload = await listProjects(member.workspace.id);

    // done + archived count as completed: 2 of 4 => 50%
    expect(payload[0]?.statistics).toMatchObject({
      totalTasks: 4,
      completionPercentage: 50,
    });
    expect(new Date(payload[0]?.statistics.dueDate as string)).toEqual(
      earliest,
    );
  });

  it("reports zeroed statistics for a project with no tasks", async () => {
    const member = await createWorkspaceMember(app.db);
    await createProjectFixture(app.db, { workspaceId: member.workspace.id });

    app.auth.signIn(member.user);
    const payload = await listProjects(member.workspace.id);

    expect(payload[0]?.statistics).toMatchObject({
      totalTasks: 0,
      completionPercentage: 0,
      dueDate: null,
    });
    expect(payload[0]?.tasks).toBeUndefined();
  });

  it("keeps statistics isolated per project", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project: alpha } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Alpha",
      slug: "alpha",
    });
    const { project: beta } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Beta",
      slug: "beta",
    });

    await seedTasks(alpha.id, [
      { title: "A1", status: "done", number: 1 },
      { title: "A2", status: "to-do", number: 2 },
    ]);
    await seedTasks(beta.id, [{ title: "B1", status: "done", number: 1 }]);

    app.auth.signIn(member.user);
    const payload = await listProjects(member.workspace.id);

    const byName = new Map(payload.map((p) => [p.name, p]));
    expect(byName.get("Alpha")?.statistics).toMatchObject({
      totalTasks: 2,
      completionPercentage: 50,
    });
    expect(byName.get("Beta")?.statistics).toMatchObject({
      totalTasks: 1,
      completionPercentage: 100,
    });
  });

  it("hides archived projects unless includeArchived is true", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project: active } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Active",
    });
    const { project: archived } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Archived",
    });
    app.auth.signIn(member.user);

    const archive = await app.request(`/api/project/${archived.id}/archive`, {
      method: "PUT",
    });
    expect(archive.status).toBe(200);
    expect(await archive.json()).toMatchObject({
      id: archived.id,
      archivedAt: expect.any(String),
    });

    expect((await listProjects(member.workspace.id)).map((p) => p.id)).toEqual([
      active.id,
    ]);
    const all = await app.request(
      `/api/project?workspaceId=${member.workspace.id}&includeArchived=true`,
    );
    expect(((await all.json()) as ProjectListEntry[]).map((p) => p.id)).toEqual(
      [active.id, archived.id],
    );

    const unarchive = await app.request(
      `/api/project/${archived.id}/unarchive`,
      { method: "PUT" },
    );
    expect(unarchive.status).toBe(200);
    expect(await unarchive.json()).toMatchObject({ archivedAt: null });
    expect(await listProjects(member.workspace.id)).toHaveLength(2);
  });
});
