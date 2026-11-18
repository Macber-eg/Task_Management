import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProjectEntity } from "../../src/database/entities/project.entity";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  app.auth.signOut();
});

async function listProjects(workspaceId: string, includeArchived = false) {
  const response = await app.request(
    `/api/project?workspaceId=${workspaceId}${includeArchived ? "&includeArchived=true" : ""}`,
  );
  return (await response.json()) as ProjectEntity[];
}

function archiveRequest(projectId: string) {
  return app.request(`/api/project/${projectId}/archive`, { method: "PUT" });
}

function reorderRequest(
  workspaceId: string,
  projects: Array<{ id: string; position: number }>,
) {
  return app.request(`/api/project/reorder?workspaceId=${workspaceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projects }),
  });
}

describe("API integration: project reorder", () => {
  it("persists the new order across a re-fetch", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project: first } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "First",
    });
    const { project: second } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Second",
    });

    app.auth.signIn(member.user);

    const response = await reorderRequest(member.workspace.id, [
      { id: second.id, position: 0 },
      { id: first.id, position: 1 },
    ]);

    expect(response.status).toBe(200);
    const reordered = (await response.json()) as Record<string, unknown>[];
    expect(reordered.map((project) => project.id)).toEqual([
      second.id,
      first.id,
    ]);
    // The plain rows, without the list route's rollups or storage keys.
    expect(reordered[0]).not.toHaveProperty("statistics");
    expect(reordered[0]).not.toHaveProperty("backgroundObjectKey");

    const projects = await listProjects(member.workspace.id);
    expect(projects.map((project) => project.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("rejects a project that belongs to another workspace", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const outsider = await createWorkspaceMember(app.db, { role: "admin" });

    const { project: first } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "First",
    });
    const { project: second } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Second",
    });
    const { project: foreign } = await createProjectFixture(app.db, {
      workspaceId: outsider.workspace.id,
    });

    app.auth.signIn(member.user);

    // A foreign project id must not be smuggled into the batch.
    const response = await reorderRequest(member.workspace.id, [
      { id: second.id, position: 0 },
      { id: first.id, position: 1 },
      { id: foreign.id, position: 2 },
    ]);

    expect(response.status).toBe(400);

    // The rejected batch must not have applied partially.
    const projects = await listProjects(member.workspace.id);
    expect(projects.map((project) => project.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("rejects a fractional position", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);

    const response = await reorderRequest(member.workspace.id, [
      { id: project.id, position: 1.5 },
    ]);

    expect(response.status).toBe(400);
  });

  it("rejects a negative position", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);

    const response = await reorderRequest(member.workspace.id, [
      { id: project.id, position: -1 },
    ]);

    expect(response.status).toBe(400);
  });

  it("rejects a duplicated project id", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);

    const response = await reorderRequest(member.workspace.id, [
      { id: project.id, position: 0 },
      { id: project.id, position: 1 },
    ]);

    expect(response.status).toBe(400);
  });

  it("normalizes out-of-range and sparse positions to 0..n-1", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project: first } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "First",
    });
    const { project: second } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Second",
    });
    const { project: third } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Third",
    });

    app.auth.signIn(member.user);

    // Storing a position near the integer ceiling verbatim would overflow the
    // column on the next create, which appends at max(position) + 1.
    const response = await reorderRequest(member.workspace.id, [
      { id: third.id, position: 0 },
      { id: first.id, position: 5 },
      { id: second.id, position: 2_000_000_000 },
    ]);

    expect(response.status).toBe(200);

    const projects = await listProjects(member.workspace.id);
    expect(projects.map((project) => project.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    expect(projects.map((project) => project.position)).toEqual([0, 1, 2]);
  });

  it("keeps workspace projects missing from the payload in place", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project: first } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "First",
    });
    const { project: second } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Second",
    });
    const { project: omitted } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Omitted",
    });

    app.auth.signIn(member.user);

    const response = await reorderRequest(member.workspace.id, [
      { id: second.id, position: 0 },
      { id: first.id, position: 1 },
    ]);

    expect(response.status).toBe(200);

    const projects = await listProjects(member.workspace.id);
    expect(projects.map((project) => project.id)).toEqual([
      second.id,
      first.id,
      omitted.id,
    ]);
    expect(projects.map((project) => project.position)).toEqual([0, 1, 2]);
  });

  it("keeps an archived project's slot in the ordering", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project: first } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "First",
    });
    // In the middle: one seeded last would look the same as one shunted
    // to the end.
    const { project: archived } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Archived",
    });
    const { project: second } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Second",
    });

    app.auth.signIn(member.user);

    expect((await archiveRequest(archived.id)).status).toBe(200);

    const response = await reorderRequest(member.workspace.id, [
      { id: second.id, position: 0 },
      { id: first.id, position: 1 },
    ]);

    expect(response.status).toBe(200);

    const visibleProjects = await listProjects(member.workspace.id);
    expect(visibleProjects.map((project) => project.id)).toEqual([
      second.id,
      first.id,
    ]);

    const allProjects = await listProjects(member.workspace.id, true);
    expect(allProjects.map((project) => project.id)).toEqual([
      second.id,
      archived.id,
      first.id,
    ]);
    expect(allProjects.map((project) => project.position)).toEqual([0, 1, 2]);
  });

  it("rejects an empty payload", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    await createProjectFixture(app.db, { workspaceId: member.workspace.id });

    app.auth.signIn(member.user);

    const response = await reorderRequest(member.workspace.id, []);

    expect(response.status).toBe(400);
  });

  it("rejects a member without project update permission", async () => {
    const viewer = await createWorkspaceMember(app.db, { role: "viewer" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: viewer.workspace.id,
    });

    app.auth.signIn(viewer.user);

    const response = await reorderRequest(viewer.workspace.id, [
      { id: project.id, position: 0 },
    ]);

    expect(response.status).toBe(403);
  });

  it("places a newly created project at the end of the order", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      name: "Existing",
    });

    app.auth.signIn(member.user);

    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Newest",
          workspaceId: member.workspace.id,
          icon: "Folder",
          slug: "newest",
        }),
      },
    );

    expect(response.status).toBe(200);

    const projects = await listProjects(member.workspace.id);
    expect(projects.at(-1)?.name).toBe("Newest");
  });
});
