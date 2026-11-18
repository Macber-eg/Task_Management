import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("project visibility authorization", () => {
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

  async function fixture(permissions: Record<string, string[]>) {
    const member = await createWorkspaceMember(app.db, { role: "limited" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    await addWorkspaceRole(app.db, member.workspace.id, "limited", permissions);
    app.auth.signIn(member.user);
    // The previous test omitted the required phase and sprint flags.
    const put = (body: Record<string, unknown>) =>
      app.request(`/api/project/${project.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: project.name,
          icon: project.icon ?? "Layout",
          slug: project.slug,
          description: project.description ?? "",
          phasesEnabled: false,
          sprintsEnabled: false,
          ...body,
        }),
      });
    const stored = async () =>
      (
        await app.db.findOne(ProjectEntity, {
          where: { id: project.id },
          select: { id: true, isPublic: true },
        })
      )?.isPublic;
    return { put, stored, project };
  }

  it("refuses to publish a private project without project:share", async () => {
    const { put, stored } = await fixture({ project: ["read", "update"] });
    const response = await put({ isPublic: true });
    expect(response.status).toBe(403);
    expect(await stored()).toBe(false);
  });

  it("allows an unrelated edit without project:share", async () => {
    const { put, stored } = await fixture({ project: ["read", "update"] });
    const response = await put({ name: "Renamed", isPublic: false });
    expect(response.status).toBe(200);
    expect(await stored()).toBe(false);
  });

  it("allows publishing with project:share", async () => {
    const { put, stored } = await fixture({
      project: ["read", "update", "share"],
    });
    expect((await put({ isPublic: true })).status).toBe(200);
    expect(await stored()).toBe(true);
  });

  it("refuses to unpublish a public project without project:share", async () => {
    const { put, stored, project } = await fixture({
      project: ["read", "update"],
    });
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic: true });
    expect((await put({ isPublic: false })).status).toBe(403);
    expect(await stored()).toBe(true);
  });

  it("applies the same rule to a scoped API key", async () => {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signInAs(
      await createApiKeyPrincipal(app.db, member.user, {
        project: ["read", "update"],
      }),
    );
    const response = await app.request(`/api/project/${project.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: project.name,
        icon: project.icon ?? "Layout",
        slug: project.slug,
        description: project.description ?? "",
        isPublic: true,
        phasesEnabled: false,
        sprintsEnabled: false,
      }),
    });
    expect(response.status).toBe(403);
  });
});
