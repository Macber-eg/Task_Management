import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceEntity } from "../../src/database/entities/workspace.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

function expected(workspace: WorkspaceEntity, role: string | null) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    logo: workspace.logo,
    description: workspace.description,
    createdAt: workspace.createdAt.toISOString(),
    role,
  };
}

const workspaceNotFound = {
  message: "Workspace not found",
  code: "NOT_FOUND",
};

const unauthorized = { message: "Unauthorized", code: "UNAUTHORIZED" };

async function readJson(response: Response) {
  expect(response.status).toBe(200);
  const body = (await response.json()) as unknown;
  const items = Array.isArray(body) ? body : [body];
  for (const item of items) {
    expect(item).not.toHaveProperty("metadata");
  }
  return body;
}

describe("workspace endpoints", () => {
  let app: TestApp;

  function createInstanceAdmin() {
    return createUser(app.db, { name: "Instance Admin", role: "admin" });
  }

  /** A second membership row for the same user, as old data can hold. */
  function addMembership(
    workspaceId: string,
    userId: string,
    role: string,
    joinedAt: Date,
  ) {
    return insertRow(app.db, WorkspaceUserEntity, {
      workspaceId,
      userId,
      role,
      joinedAt,
    });
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

  describe("GET /api/workspace", () => {
    it("lists only the caller's workspaces with their role, sorted by name", async () => {
      const caller = await createUser(app.db, { name: "Caller" });
      const beta = await createWorkspace(app.db, { name: "beta" });
      const alpha = await createWorkspace(app.db, { name: "Alpha" });
      const charlie = await createWorkspace(app.db, { name: "Charlie" });
      const twinB = await createWorkspace(app.db, {
        id: "workspace-b",
        name: "Twin",
      });
      const twinA = await createWorkspace(app.db, {
        id: "workspace-a",
        name: "twin",
      });
      await addWorkspaceMember(app.db, beta.id, caller.id, "owner");
      await addWorkspaceMember(app.db, alpha.id, caller.id, "member");
      await addWorkspaceMember(app.db, charlie.id, caller.id, "admin");
      await addWorkspaceMember(app.db, twinB.id, caller.id, "viewer");
      await addWorkspaceMember(app.db, twinA.id, caller.id, "member");
      await createWorkspaceMember(app.db, { workspaceName: "Aardvark" });
      app.auth.signIn(caller);

      const response = await app.request("/api/workspace");

      expect(await readJson(response)).toEqual([
        expected(alpha, "member"),
        expected(beta, "owner"),
        expected(charlie, "admin"),
        expected(twinA, "member"),
        expected(twinB, "viewer"),
      ]);
    });

    it("lists a workspace once when the caller has a duplicate membership row", async () => {
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      await addMembership(
        workspace.id,
        user.id,
        "member",
        new Date(Date.now() + 60_000),
      );
      app.auth.signIn(user);

      const response = await app.request("/api/workspace");

      expect(await readJson(response)).toEqual([expected(workspace, "owner")]);
    });

    it("only lists an instance admin's own memberships", async () => {
      await createWorkspaceMember(app.db, { workspaceName: "Someone else's" });
      const admin = await createInstanceAdmin();
      const joined = await createWorkspace(app.db, { name: "Joined" });
      await addWorkspaceMember(app.db, joined.id, admin.id, "member");
      app.auth.signIn(admin);

      const response = await app.request("/api/workspace");

      expect(await readJson(response)).toEqual([expected(joined, "member")]);
    });

    it("leaves out workspaces where the caller's role lacks workspace:read", async () => {
      const { user, workspace: hidden } = await createWorkspaceMember(app.db, {
        role: "limited",
        workspaceName: "Hidden",
      });
      await addWorkspaceRole(app.db, hidden.id, "limited", { task: ["read"] });
      const edited = await createWorkspace(app.db, { name: "Edited viewer" });
      await addWorkspaceMember(app.db, edited.id, user.id, "viewer");
      await addWorkspaceRole(app.db, edited.id, "viewer", {
        project: ["read"],
      });
      const custom = await createWorkspace(app.db, { name: "Custom" });
      await addWorkspaceMember(app.db, custom.id, user.id, "reader");
      await addWorkspaceRole(app.db, custom.id, "reader", {
        workspace: ["read"],
      });
      const visible = await createWorkspace(app.db, { name: "Visible" });
      await addWorkspaceMember(app.db, visible.id, user.id, "member");
      app.auth.signIn(user);

      const response = await app.request("/api/workspace");

      expect(await readJson(response)).toEqual([
        expected(custom, "reader"),
        expected(visible, "member"),
      ]);
    });

    it("lists and reads a workspace when any of the caller's roles grants workspace:read", async () => {
      const { user, workspace: custom } = await createWorkspaceMember(app.db, {
        role: "limited,reader",
        workspaceName: "Custom",
      });
      await addWorkspaceRole(app.db, custom.id, "limited", { task: ["read"] });
      await addWorkspaceRole(app.db, custom.id, "reader", {
        workspace: ["read"],
      });
      const builtIn = await createWorkspace(app.db, { name: "Built-in" });
      await addWorkspaceMember(app.db, builtIn.id, user.id, "limited, viewer");
      await addWorkspaceRole(app.db, builtIn.id, "limited", {
        task: ["read"],
      });
      app.auth.signIn(user);

      const list = await app.request("/api/workspace");
      const customSingle = await app.request(`/api/workspace/${custom.id}`);
      const builtInSingle = await app.request(`/api/workspace/${builtIn.id}`);

      expect(await readJson(list)).toEqual([
        expected(builtIn, "limited, viewer"),
        expected(custom, "limited,reader"),
      ]);
      expect(await readJson(customSingle)).toEqual(
        expected(custom, "limited,reader"),
      );
      expect(await readJson(builtInSingle)).toEqual(
        expected(builtIn, "limited, viewer"),
      );
    });

    it("hides a workspace when none of the caller's roles grants workspace:read", async () => {
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "limited,other",
      });
      await addWorkspaceRole(app.db, workspace.id, "limited", {
        task: ["read"],
      });
      await addWorkspaceRole(app.db, workspace.id, "other", {
        project: ["read"],
      });
      await addWorkspaceRole(app.db, workspace.id, "reader", {
        workspace: ["read"],
      });
      app.auth.signIn(user);

      const list = await app.request("/api/workspace");
      const single = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(list)).toEqual([]);
      expect(single.status).toBe(404);
      expect(await readErrorBody(single)).toEqual(workspaceNotFound);
    });

    it("grants access when any duplicate role row grants workspace:read", async () => {
      const { user, workspace: readFirst } = await createWorkspaceMember(
        app.db,
        { role: "custom", workspaceName: "Read first" },
      );
      await addWorkspaceRole(app.db, readFirst.id, "custom", {
        workspace: ["read"],
      });
      await addWorkspaceRole(app.db, readFirst.id, "custom", {
        task: ["read"],
      });
      const readLast = await createWorkspace(app.db, { name: "Read last" });
      await addWorkspaceMember(app.db, readLast.id, user.id, "custom");
      await addWorkspaceRole(app.db, readLast.id, "custom", {
        task: ["read"],
      });
      await addWorkspaceRole(app.db, readLast.id, "custom", {
        workspace: ["read"],
      });
      const noRead = await createWorkspace(app.db, { name: "No read" });
      await addWorkspaceMember(app.db, noRead.id, user.id, "custom");
      await addWorkspaceRole(app.db, noRead.id, "custom", { task: ["read"] });
      await addWorkspaceRole(app.db, noRead.id, "custom", {
        project: ["read"],
      });
      app.auth.signIn(user);

      const list = await app.request("/api/workspace");
      const first = await app.request(`/api/workspace/${readFirst.id}`);
      const last = await app.request(`/api/workspace/${readLast.id}`);
      const denied = await app.request(`/api/workspace/${noRead.id}`);

      expect(await readJson(list)).toEqual([
        expected(readFirst, "custom"),
        expected(readLast, "custom"),
      ]);
      expect(await readJson(first)).toEqual(expected(readFirst, "custom"));
      expect(await readJson(last)).toEqual(expected(readLast, "custom"));
      expect(denied.status).toBe(404);
    });

    it("lists an instance admin's membership even when the role lacks workspace:read", async () => {
      const admin = await createInstanceAdmin();
      const workspace = await createWorkspace(app.db, { name: "Limited" });
      await addWorkspaceMember(app.db, workspace.id, admin.id, "limited");
      await addWorkspaceRole(app.db, workspace.id, "limited", {
        task: ["read"],
      });
      app.auth.signIn(admin);

      const list = await app.request("/api/workspace");
      const single = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(list)).toEqual([expected(workspace, "limited")]);
      expect(await readJson(single)).toEqual(expected(workspace, "limited"));
    });

    it("returns an empty list when the caller has no workspaces", async () => {
      await createWorkspaceMember(app.db);
      const caller = await createUser(app.db, { name: "Lonely" });
      app.auth.signIn(caller);

      const response = await app.request("/api/workspace");

      expect(await readJson(response)).toEqual([]);
    });

    it("rejects missing credentials", async () => {
      app.auth.signOut();

      const response = await app.request("/api/workspace");

      expect(response.status).toBe(401);
      expect(await readErrorBody(response)).toEqual(unauthorized);
    });
  });

  describe("GET /api/workspace/{workspaceId}", () => {
    it("returns the workspace with exactly the documented fields", async () => {
      const caller = await createUser(app.db, { name: "Member" });
      const workspace = await createWorkspace(app.db, {
        name: "Product",
        logo: "https://example.com/logo.png",
        description: "Where the roadmap lives",
        metadata: JSON.stringify({ description: "Older text", secret: "x" }),
      });
      await addWorkspaceMember(app.db, workspace.id, caller.id, "admin");
      app.auth.signIn(caller);

      const response = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(response)).toEqual(expected(workspace, "admin"));
    });

    it("falls back to the description stored in metadata", async () => {
      const { user } = await createWorkspaceMember(app.db);
      const workspace = await createWorkspace(app.db, {
        metadata: JSON.stringify({ description: "From metadata" }),
      });
      await addWorkspaceMember(app.db, workspace.id, user.id, "member");
      app.auth.signIn(user);

      const response = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(response)).toEqual({
        ...expected(workspace, "member"),
        description: "From metadata",
      });
    });

    it("returns null for a missing or unreadable description", async () => {
      const { user } = await createWorkspaceMember(app.db);
      const workspace = await createWorkspace(app.db, {
        description: "  ",
        metadata: "{not json",
      });
      await addWorkspaceMember(app.db, workspace.id, user.id, "member");
      app.auth.signIn(user);

      const response = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(response)).toEqual({
        ...expected(workspace, "member"),
        description: null,
      });
    });

    it("returns the earliest membership role when the caller has duplicate rows", async () => {
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      await addMembership(
        workspace.id,
        user.id,
        "member",
        new Date(Date.now() + 60_000),
      );
      app.auth.signIn(user);

      const response = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(response)).toEqual(expected(workspace, "owner"));
    });

    it("returns the same 404 for a non-member and a nonexistent workspace", async () => {
      const { workspace } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      const outsider = await createWorkspaceMember(app.db);
      app.auth.signIn(outsider.user);

      const notMember = await app.request(`/api/workspace/${workspace.id}`);
      const missing = await app.request("/api/workspace/workspace-missing");

      expect(notMember.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await readErrorBody(notMember)).toEqual(workspaceNotFound);
      expect(await readErrorBody(missing)).toEqual(workspaceNotFound);
    });

    it("returns the same 404 when the caller's role lacks workspace:read", async () => {
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "limited",
      });
      await addWorkspaceRole(app.db, workspace.id, "limited", {
        task: ["read"],
      });
      app.auth.signIn(user);

      const denied = await app.request(`/api/workspace/${workspace.id}`);
      const missing = await app.request("/api/workspace/workspace-missing");

      expect(denied.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await readErrorBody(denied)).toEqual(workspaceNotFound);
      expect(await readErrorBody(missing)).toEqual(workspaceNotFound);
    });

    it("lets an instance admin read a workspace they are not a member of", async () => {
      const { workspace } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      const admin = await createInstanceAdmin();
      app.auth.signIn(admin);

      const response = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(response)).toEqual(expected(workspace, null));
    });

    it("returns 404 to an instance admin for a nonexistent workspace", async () => {
      const admin = await createInstanceAdmin();
      app.auth.signIn(admin);

      const response = await app.request("/api/workspace/workspace-missing");

      expect(response.status).toBe(404);
      expect(await readErrorBody(response)).toEqual(workspaceNotFound);
    });

    it("rejects missing credentials", async () => {
      const { workspace } = await createWorkspaceMember(app.db);
      app.auth.signOut();

      const response = await app.request(`/api/workspace/${workspace.id}`);

      expect(response.status).toBe(401);
      expect(await readErrorBody(response)).toEqual(unauthorized);
    });
  });

  // The previous suite sent real keys; verifying a key is the authenticator's
  // job, so these start from the caller it produces for a valid one.
  describe("workspace endpoints with an API key", () => {
    it("accepts an API key without a scope", async () => {
      await createWorkspaceMember(app.db, { workspaceName: "Not mine" });
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      app.auth.signInAs(await createApiKeyPrincipal(app.db, user));

      const list = await app.request("/api/workspace");
      const single = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(list)).toEqual([expected(workspace, "owner")]);
      expect(await readJson(single)).toEqual(expected(workspace, "owner"));
    });

    it("rejects an API key without workspace:read on both routes", async () => {
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      app.auth.signInAs(
        await createApiKeyPrincipal(app.db, user, {
          task: ["read"],
          project: ["read"],
        }),
      );

      const list = await app.request("/api/workspace");
      const single = await app.request(`/api/workspace/${workspace.id}`);

      const scopeError = {
        message: "Insufficient API key scope",
        code: "API_KEY_SCOPE",
        missingPermissions: ["workspace:read"],
      };
      expect(list.status).toBe(403);
      expect(await readErrorBody(list)).toEqual(scopeError);
      expect(single.status).toBe(403);
      expect(await readErrorBody(single)).toEqual(scopeError);
    });

    it("accepts an API key scoped to workspace:read", async () => {
      const { user, workspace } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      app.auth.signInAs(
        await createApiKeyPrincipal(app.db, user, { workspace: ["read"] }),
      );

      const list = await app.request("/api/workspace");
      const single = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(list)).toEqual([expected(workspace, "owner")]);
      expect(await readJson(single)).toEqual(expected(workspace, "owner"));
    });

    it("reads the instance admin role from the database for API keys", async () => {
      const { workspace } = await createWorkspaceMember(app.db, {
        role: "owner",
      });
      const admin = await createInstanceAdmin();
      app.auth.signInAs(await createApiKeyPrincipal(app.db, admin));

      const response = await app.request(`/api/workspace/${workspace.id}`);

      expect(await readJson(response)).toEqual(expected(workspace, null));
    });

    it("accepts a session token as a bearer token", async () => {
      const real = await createTestApp({ realAuth: true });
      try {
        const password = "correct horse battery staple";
        const signUp = await real.request("/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Bearer",
            email: "bearer@example.com",
            password,
          }),
        });
        expect(signUp.status).toBe(200);
        const { user } = (await signUp.json()) as { user: { id: string } };
        const workspace = await createWorkspace(app.db, {
          name: "Bearer workspace",
        });
        await addWorkspaceMember(app.db, workspace.id, user.id, "member");

        const signIn = await real.request("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "bearer@example.com", password }),
        });
        const { token } = (await signIn.json()) as { token: string };
        expect(token).toBeTruthy();

        const response = await real.request("/api/workspace", {
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(await readJson(response)).toEqual([
          expected(workspace, "member"),
        ]);
      } finally {
        await real.close();
      }
    });

    it("rejects an invalid API key", async () => {
      const real = await createTestApp({ realAuth: true });
      try {
        const response = await real.request("/api/workspace", {
          headers: { "x-api-key": "invalid-key" },
        });

        expect(response.status).toBe(401);
        expect(await readErrorBody(response)).toEqual(unauthorized);
      } finally {
        await real.close();
      }
    });
  });
});
