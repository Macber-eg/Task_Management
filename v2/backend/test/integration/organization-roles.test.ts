import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceEntity } from "../../src/database/entities/workspace.entity";
import { WorkspaceRoleEntity } from "../../src/database/entities/workspace-role.entity";
import { DefaultRolesBackfill } from "../../src/organization/roles/default-roles-backfill";
import { defaultRolePayloads } from "../../src/permissions";
import { type Browser, signUpBrowser } from "../support/browser";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { insertRow } from "../support/fixtures/insert-row";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type RoleBody = {
  id: string;
  role: string;
  organizationId: string;
  permission: Record<string, string[]>;
};

describe("API integration: workspace roles and permissions", () => {
  let app: TestApp;

  async function ownedWorkspace() {
    const owner = await signUpBrowser(app, "owner@example.com", "Owner");
    const created = await owner.post("/api/auth/organization/create", {
      name: "Agency",
      slug: "agency",
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    return { owner, workspaceId: id };
  }

  async function memberWith(workspaceId: string, email: string, role: string) {
    const browser = await signUpBrowser(app, email);
    await addWorkspaceMember(app.db, workspaceId, browser.userId, role);
    return browser;
  }

  function hasPermission(browser: Browser, body: Record<string, unknown>) {
    return browser.post("/api/auth/organization/has-permission", body);
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  it("answers whether the caller's role allows actions", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const viewer = await memberWith(workspaceId, "viewer@example.com", "viewer");

    const ownerCan = await hasPermission(owner, {
      permissions: { organization: ["delete"], project: ["share"] },
    });
    expect(await ownerCan.json()).toEqual({ error: null, success: true });

    const viewerCannot = await hasPermission(viewer, {
      organizationId: workspaceId,
      permissions: { task: ["read", "create"] },
    });
    expect(await viewerCannot.json()).toEqual({ error: null, success: false });

    const deprecated = await hasPermission(owner, {
      permission: { task: ["read"] },
    });
    expect(await deprecated.json()).toEqual({ error: null, success: false });

    const both = await hasPermission(owner, {
      permission: { task: ["read"] },
      permissions: { task: ["read"] },
    });
    expect(both.status).toBe(400);

    const outsider = await signUpBrowser(app, "outsider@example.com");
    const notMember = await hasPermission(outsider, {
      organizationId: workspaceId,
      permissions: { task: ["read"] },
    });
    expect(notMember.status).toBe(401);
    expect((await readErrorBody(notMember)).code).toBe(
      "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
    );
  });

  it("answers for the owner of an API key", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const { key } = await seedApiKey(app.db, owner.userId);

    const response = await app.request("/api/auth/organization/has-permission", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        organizationId: workspaceId,
        permissions: { workspace: ["delete"] },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ error: null, success: true });
  });

  it("revokes provider administrative permissions after the owner saves an empty role", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    const admin = await signUpBrowser(app, "admin@example.com");
    const workspace = await createWorkspace(app.db, { name: "Workspace" });
    await addWorkspaceMember(app.db, workspace.id, owner.userId, "owner");
    await addWorkspaceMember(app.db, workspace.id, admin.userId, "admin");
    await insertRow(app.db, WorkspaceRoleEntity, {
      workspaceId: workspace.id,
      role: "admin",
      permission: JSON.stringify(defaultRolePayloads.admin),
    });
    const canManage = () =>
      hasPermission(admin, {
        organizationId: workspace.id,
        permissions: {
          ac: ["update"],
          member: ["update"],
          invitation: ["create"],
        },
      });
    expect(await (await canManage()).json()).toMatchObject({ success: true });

    const demote = await owner.post("/api/auth/organization/update-role", {
      organizationId: workspace.id,
      roleName: "admin",
      data: { permission: {} },
    });
    expect(demote.status).toBe(200);
    expect(await (await canManage()).json()).toMatchObject({ success: false });

    const restore = await admin.post("/api/auth/organization/update-role", {
      organizationId: workspace.id,
      roleName: "admin",
      data: { permission: defaultRolePayloads.admin },
    });
    expect(restore.status).toBe(403);
  });

  it("creates, reads, renames and deletes a custom role", async () => {
    const { owner, workspaceId } = await ownedWorkspace();

    const created = await owner.post("/api/auth/organization/create-role", {
      role: "Client",
      permission: { task: ["read"], project: ["read"] },
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as {
      success: boolean;
      roleData: RoleBody;
      statements: Record<string, string[]>;
    };
    expect(body).toMatchObject({
      success: true,
      roleData: {
        role: "client",
        organizationId: workspaceId,
        permission: { task: ["read"], project: ["read"] },
      },
      statements: { task: ["read"], project: ["read"] },
    });

    const listed = await owner.get(
      `/api/auth/organization/list-roles?organizationId=${workspaceId}`,
    );
    expect(
      ((await listed.json()) as RoleBody[]).map((role) => role.role).sort(),
    ).toEqual(["admin", "client", "member", "viewer"]);

    const fetched = await owner.get(
      "/api/auth/organization/get-role?roleName=client",
    );
    expect(await fetched.json()).toMatchObject({
      id: body.roleData.id,
      permission: { task: ["read"], project: ["read"] },
    });

    const renamed = await owner.post("/api/auth/organization/update-role", {
      roleId: body.roleData.id,
      data: { roleName: "Customer", permission: { task: ["read"] } },
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      success: true,
      roleData: { role: "customer", permission: { task: ["read"] } },
    });

    const deleted = await owner.post("/api/auth/organization/delete-role", {
      roleName: "customer",
    });
    expect(await deleted.json()).toEqual({ success: true });
    expect(
      await app.db.countBy(WorkspaceRoleEntity, { id: body.roleData.id }),
    ).toBe(0);
  });

  it("guards role names, resources and grants", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const admin = await memberWith(workspaceId, "admin@example.com", "admin");
    const create = (browser: Browser, body: Record<string, unknown>) =>
      browser.post("/api/auth/organization/create-role", {
        organizationId: workspaceId,
        ...body,
      });

    for (const role of ["Owner", "admin"]) {
      const taken = await create(owner, { role, permission: {} });
      expect(taken.status).toBe(400);
      expect((await readErrorBody(taken)).code).toBe("ROLE_NAME_IS_ALREADY_TAKEN");
    }

    const invalid = await create(owner, {
      role: "odd",
      permission: { spaceship: ["fly"] },
    });
    expect(invalid.status).toBe(400);
    expect((await readErrorBody(invalid)).code).toBe("INVALID_RESOURCE");

    const beyond = await create(admin, {
      role: "deleter",
      permission: { workspace: ["delete"], task: ["read"] },
    });
    expect(beyond.status).toBe(403);
    expect(await readErrorBody(beyond)).toEqual({
      code: "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE",
      message: "You are not allowed to create a role",
      missingPermissions: ["workspace:delete"],
    });

    const plain = await memberWith(workspaceId, "plain@example.com", "member");
    const notAllowed = await create(plain, { role: "x", permission: {} });
    expect(notAllowed.status).toBe(403);
    expect((await readErrorBody(notAllowed)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE",
    );

    const listByMember = await plain.get(
      `/api/auth/organization/list-roles?organizationId=${workspaceId}`,
    );
    expect(listByMember.status).toBe(200);

    const predefined = await owner.post("/api/auth/organization/delete-role", {
      roleName: "owner",
    });
    expect(predefined.status).toBe(400);
    expect((await readErrorBody(predefined)).code).toBe(
      "CANNOT_DELETE_A_PRE_DEFINED_ROLE",
    );

    const assigned = await owner.post("/api/auth/organization/delete-role", {
      roleName: "admin",
    });
    expect(assigned.status).toBe(400);
    expect((await readErrorBody(assigned)).code).toBe(
      "ROLE_IS_ASSIGNED_TO_MEMBERS",
    );

    const missing = await owner.get(
      "/api/auth/organization/get-role?roleName=ghost",
    );
    expect(missing.status).toBe(400);
    expect((await readErrorBody(missing)).code).toBe("ROLE_NOT_FOUND");

    const noSelector = await owner.get("/api/auth/organization/get-role");
    expect(noSelector.status).toBe(400);
    expect((await readErrorBody(noSelector)).code).toBe("VALIDATION_ERROR");
  });

  it("caps a workspace at 25 stored roles", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    for (let index = 0; index < 22; index++) {
      await insertRow(app.db, WorkspaceRoleEntity, {
        workspaceId,
        role: `role-${index}`,
        permission: "{}",
      });
    }

    const response = await owner.post("/api/auth/organization/create-role", {
      role: "one-too-many",
      permission: {},
    });

    expect(response.status).toBe(400);
    expect((await readErrorBody(response)).code).toBe("TOO_MANY_ROLES");
  });

  it("backfills the default roles of workspaces created without them", async () => {
    const bare = await createWorkspace(app.db, { name: "Old" });
    const partial = await createWorkspace(app.db, { name: "Half" });
    await insertRow(app.db, WorkspaceRoleEntity, {
      workspaceId: partial.id,
      role: "admin",
      permission: JSON.stringify({ task: ["read"] }),
    });

    await app.get(DefaultRolesBackfill).onApplicationBootstrap();
    await app.get(DefaultRolesBackfill).onApplicationBootstrap();

    const rows = await app.db.find(WorkspaceRoleEntity);
    const names = (workspace: WorkspaceEntity) =>
      rows
        .filter((row) => row.workspaceId === workspace.id)
        .map((row) => row.role)
        .sort();
    expect(names(bare)).toEqual(["admin", "member", "viewer"]);
    expect(names(partial)).toEqual(["admin", "member", "viewer"]);
    expect(
      rows.find((row) => row.workspaceId === partial.id && row.role === "admin")
        ?.permission,
    ).toBe(JSON.stringify({ task: ["read"] }));
    expect(
      JSON.parse(
        rows.find((row) => row.workspaceId === bare.id && row.role === "viewer")
          ?.permission ?? "null",
      ),
    ).toEqual(defaultRolePayloads.viewer);
  });
});
