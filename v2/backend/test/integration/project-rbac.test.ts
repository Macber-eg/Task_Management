import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The project section of the previous workspace RBAC tests.
describe("resource coverage: project:create / update / delete", () => {
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

  function create(workspaceId: string, name: string, slug: string) {
    return app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, workspaceId, slug, icon: "Folder" }),
    });
  }

  // The previous test omitted the required phase and sprint flags.
  function rename(projectId: string, name: string, slug: string) {
    return app.request(`/api/project/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        icon: "Folder",
        slug,
        description: "",
        isPublic: false,
        phasesEnabled: false,
        sprintsEnabled: false,
      }),
    });
  }

  async function signedInWithProject(role: string) {
    const member = await createWorkspaceMember(app.db, { role });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);
    return project;
  }

  it("allows a member to create a project", async () => {
    const member = await createWorkspaceMember(app.db, { role: "member" });
    app.auth.signIn(member.user);
    expect(
      (await create(member.workspace.id, "Member-made", "MEM")).status,
    ).toBe(200);
  });

  it("blocks a viewer from creating a project", async () => {
    const member = await createWorkspaceMember(app.db, { role: "viewer" });
    app.auth.signIn(member.user);
    expect(
      (await create(member.workspace.id, "Viewer attempt", "VWR")).status,
    ).toBe(403);
  });

  it("blocks a member from updating a project (project:update is admin-tier)", async () => {
    const project = await signedInWithProject("member");
    expect(
      (await rename(project.id, "Member-rename", project.slug)).status,
    ).toBe(403);
  });

  it("allows an admin to update a project", async () => {
    const project = await signedInWithProject("admin");
    expect(
      (await rename(project.id, "Admin-rename", project.slug)).status,
    ).toBe(200);
  });

  it("blocks a member from deleting a project (project:delete is admin-tier)", async () => {
    const project = await signedInWithProject("member");
    const response = await app.request(`/api/project/${project.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(403);
  });

  it("allows an admin to delete a project", async () => {
    const project = await signedInWithProject("admin");
    const response = await app.request(`/api/project/${project.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
  });
});
