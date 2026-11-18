import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defaultRolePayloads,
  WORKSPACE_CAPABILITY_NAMES,
} from "../../src/permissions";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GET /api/workspace/{workspaceId}/capabilities", () => {
  let app: TestApp;

  function getCapabilities(workspaceId: string) {
    return app.request(`/api/workspace/${workspaceId}/capabilities`);
  }

  async function seedWorkspace() {
    const workspace = await createWorkspace(app.db, {
      id: "capabilities-workspace",
    });
    await addWorkspaceRole(
      app.db,
      workspace.id,
      "viewer",
      defaultRolePayloads.viewer,
    );
    await addWorkspaceRole(app.db, workspace.id, "triage", {
      workspace: ["read"],
      project: ["read"],
      task: ["read", "create", "update"],
    });
    return workspace;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("reports every capability for the caller's role in one response", async () => {
    const owner = await createUser(app.db);
    const viewer = await createUser(app.db);
    const triage = await createUser(app.db);
    const workspace = await seedWorkspace();
    await addWorkspaceMember(app.db, workspace.id, owner.id, "owner");
    await addWorkspaceMember(app.db, workspace.id, viewer.id, "viewer");
    await addWorkspaceMember(app.db, workspace.id, triage.id, "triage");

    app.auth.signIn(owner);
    const ownerResponse = await getCapabilities(workspace.id);
    expect(ownerResponse.status).toBe(200);
    const ownerCapabilities = (await ownerResponse.json()) as Record<
      string,
      boolean
    >;
    expect(Object.keys(ownerCapabilities).sort()).toEqual(
      [...WORKSPACE_CAPABILITY_NAMES].sort(),
    );
    expect(Object.values(ownerCapabilities).every(Boolean)).toBe(true);

    app.auth.signIn(viewer);
    const viewerCapabilities = await (
      await getCapabilities(workspace.id)
    ).json();
    expect(viewerCapabilities).toMatchObject({
      createTasks: false,
      updateTasks: false,
      manageWorkspace: false,
      inviteUsers: false,
    });

    // Custom roles resolve from the stored definition, like enforcement does.
    app.auth.signIn(triage);
    const triageCapabilities = await (
      await getCapabilities(workspace.id)
    ).json();
    expect(triageCapabilities).toMatchObject({
      createTasks: true,
      updateTasks: true,
      deleteTasks: false,
      createProjects: false,
    });
  });

  it("does not reveal capabilities in a workspace the caller isn't in", async () => {
    const owner = await createUser(app.db);
    const outsider = await createUser(app.db);
    const workspace = await seedWorkspace();
    await addWorkspaceMember(app.db, workspace.id, owner.id, "owner");
    app.auth.signIn(outsider);

    const response = await getCapabilities(workspace.id);
    expect(response.status).toBe(404);
  });

  // Not in the previous suite: pins the two callers the route description
  // promises beyond a member's roles.
  it("allows an instance admin everything and narrows an API key to its scope", async () => {
    const owner = await createUser(app.db);
    const admin = await createUser(app.db, { role: "admin" });
    const workspace = await seedWorkspace();
    await addWorkspaceMember(app.db, workspace.id, owner.id, "owner");

    app.auth.signIn(admin);
    const adminCapabilities = (await (
      await getCapabilities(workspace.id)
    ).json()) as Record<string, boolean>;
    expect(Object.values(adminCapabilities).every(Boolean)).toBe(true);

    app.auth.signInAs(
      await createApiKeyPrincipal(app.db, owner, { task: ["create"] }),
    );
    const keyCapabilities = (await (
      await getCapabilities(workspace.id)
    ).json()) as Record<string, boolean>;
    expect(
      Object.keys(keyCapabilities).filter((name) => keyCapabilities[name]),
    ).toEqual(["createTasks"]);
  });
});
