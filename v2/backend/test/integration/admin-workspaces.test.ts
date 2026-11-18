import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRoleEntity } from "../../src/database/entities/workspace-role.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { EventBus } from "../../src/events/event-bus";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { createMember } from "../support/fixtures/create-member";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { createUser } from "../support/fixtures/create-user";
import { insertRow } from "../support/fixtures/insert-row";
import { readMemberAccessRows } from "../support/fixtures/read-member-access-rows";
import {
  realtimeDouble,
  resetRealtimeDouble,
} from "../support/realtime-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("instance admin workspace management", () => {
  const realtime = realtimeDouble();
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let app: TestApp;

  async function request(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    return app.request(`/api${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  async function roleOf(workspaceId: string, userId: string) {
    const member = await app.db.findOne(WorkspaceUserEntity, {
      where: { workspaceId, userId },
    });
    return member?.role ?? null;
  }

  const signInAdmin = async () =>
    app.auth.signIn(
      await createUser(app.db, { name: "Instance Admin", role: "admin" }),
    );

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[RealtimeConnections, realtime]] });
    for (const type of ["project_access.updated", "project_members.updated"]) {
      app
        .get(EventBus)
        .subscribe<Record<string, unknown>>(type, async (data) => {
          events.push({ type, data });
        });
    }
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    resetRealtimeDouble(realtime);
    events.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it("is limited to instance administrators", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.owner);

    expect((await request("/admin/workspaces")).status).toBe(403);
    expect(
      (
        await request(`/admin/workspaces/${ctx.workspace.id}/owner`, {
          method: "PUT",
          body: { userId: ctx.restricted.id },
        })
      ).status,
    ).toBe(403);
    expect(await roleOf(ctx.workspace.id, ctx.owner.id)).toBe("owner");
  });

  it("lists every workspace with owners and counts", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    await signInAdmin();

    const response = await request(
      `/admin/workspaces?search=${encodeURIComponent(ctx.workspace.name)}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      total: number;
      workspaces: Record<string, unknown>[];
    };
    expect(body.total).toBe(1);
    expect(body.workspaces[0]).toEqual({
      id: ctx.workspace.id,
      name: ctx.workspace.name,
      slug: ctx.workspace.slug,
      createdAt: ctx.workspace.createdAt.toISOString(),
      memberCount: 2,
      projectCount: 2,
      owners: [
        { id: ctx.owner.id, name: ctx.owner.name, email: ctx.owner.email },
      ],
    });
  });

  it("transfers ownership to a member and makes the previous owner an admin", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    await signInAdmin();

    const response = await request(`/admin/workspaces/${ctx.workspace.id}/owner`, {
      method: "PUT",
      body: { userId: ctx.restricted.id },
    });

    expect(response.status).toBe(200);
    expect(await roleOf(ctx.workspace.id, ctx.restricted.id)).toBe("owner");
    expect(await roleOf(ctx.workspace.id, ctx.owner.id)).toBe("admin");
    expect(
      await readMemberAccessRows(app.db, ctx.workspace.id, ctx.restricted.id),
    ).toEqual({ rules: [], grants: [] });
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "project_access.updated",
        data: expect.objectContaining({
          workspaceId: ctx.workspace.id,
          userId: ctx.restricted.id,
        }),
      }),
    );

    const again = await request(`/admin/workspaces/${ctx.workspace.id}/owner`, {
      method: "PUT",
      body: { userId: ctx.restricted.id },
    });
    expect(again.status).toBe(400);
  });

  it("protects the only owner from role changes and removal", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    await signInAdmin();

    const demoted = await request(
      `/admin/workspaces/${ctx.workspace.id}/members/${ctx.owner.id}/role`,
      { method: "PUT", body: { role: "admin" } },
    );
    expect(demoted.status).toBe(409);

    const removed = await request(
      `/admin/workspaces/${ctx.workspace.id}/members/${ctx.owner.id}`,
      { method: "DELETE" },
    );
    expect(removed.status).toBe(409);
    expect(await roleOf(ctx.workspace.id, ctx.owner.id)).toBe("owner");
  });

  it("changes roles to built-in and custom roles but never to owner", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    await insertRow(app.db, WorkspaceRoleEntity, {
      workspaceId: ctx.workspace.id,
      role: "reviewer",
      permission: JSON.stringify({ task: ["read"] }),
    });
    await signInAdmin();
    const setRole = (role: string) =>
      request(
        `/admin/workspaces/${ctx.workspace.id}/members/${ctx.restricted.id}/role`,
        { method: "PUT", body: { role } },
      );

    expect((await setRole("viewer")).status).toBe(200);
    expect((await setRole("reviewer")).status).toBe(200);
    expect(await roleOf(ctx.workspace.id, ctx.restricted.id)).toBe("reviewer");
    expect((await setRole("owner")).status).toBe(400);
    expect((await setRole("made-up")).status).toBe(400);

    const roles = await request(`/admin/workspaces/${ctx.workspace.id}/roles`);
    expect(await roles.json()).toEqual(["viewer", "member", "admin", "reviewer"]);
  });

  it("removes a member, clears their project access and revokes their sockets", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    await signInAdmin();

    const response = await request(
      `/admin/workspaces/${ctx.workspace.id}/members/${ctx.restricted.id}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    const members = (await response.json()) as { userId: string }[];
    expect(members.map((member) => member.userId)).toEqual([ctx.owner.id]);
    expect(
      await readMemberAccessRows(app.db, ctx.workspace.id, ctx.restricted.id),
    ).toEqual({ rules: [], grants: [] });
    expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
      ctx.restricted.id,
      ctx.workspace.id,
      { role: null },
    );
  });

  it("adds an existing user with every project and rejects duplicates", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const other = await createRestrictedWorkspace(app.db);
    await signInAdmin();
    const add = (userId: string, role = "member") =>
      request(`/admin/workspaces/${ctx.workspace.id}/members`, {
        method: "POST",
        body: { userId, role },
      });

    const added = await add(other.owner.id);
    expect(added.status).toBe(200);
    expect(await roleOf(ctx.workspace.id, other.owner.id)).toBe("member");
    expect(
      await readMemberAccessRows(app.db, ctx.workspace.id, other.owner.id),
    ).toEqual({ rules: [], grants: [] });
    const members = (await added.json()) as Record<string, unknown>[];
    expect(members.find((member) => member.userId === other.owner.id)).toEqual(
      {
        userId: other.owner.id,
        name: other.owner.name,
        email: other.owner.email,
        image: null,
        role: "member",
        joinedAt: expect.any(String),
      },
    );

    expect((await add(other.owner.id)).status).toBe(409);
    expect((await add("missing-user")).status).toBe(404);
    expect((await add(other.restricted.id, "owner")).status).toBe(400);
  });

  it("answers 404 for a workspace that does not exist", async () => {
    await signInAdmin();
    for (const path of ["members", "roles"]) {
      expect((await request(`/admin/workspaces/missing/${path}`)).status).toBe(
        404,
      );
    }
    expect(
      (
        await request("/admin/workspaces/missing/members/user", {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("lets an instance admin limit a member's projects without joining", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const member = await createMember(app.db, ctx.workspace.id);
    await signInAdmin();

    const response = await request(
      `/workspace/${ctx.workspace.id}/members/${member.id}/project-access`,
      {
        method: "PUT",
        body: { projectAccess: "selected", projectIds: [ctx.beta.id] },
      },
    );

    expect(response.status).toBe(200);
    expect(
      (await readMemberAccessRows(app.db, ctx.workspace.id, member.id)).grants.map(
        (grant) => grant.projectId,
      ),
    ).toEqual([ctx.beta.id]);
  });
});
