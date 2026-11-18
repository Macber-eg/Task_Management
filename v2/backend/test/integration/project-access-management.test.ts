import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { InvitationEntity } from "../../src/database/entities/invitation.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { EventBus } from "../../src/events/event-bus";
import { listAccessibleProjectIds } from "../../src/project-access/list-accessible-project-ids";
import { signUpBrowser } from "../support/browser";
import { createMember } from "../support/fixtures/create-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { readMemberAccessRows } from "../support/fixtures/read-member-access-rows";
import { restrictToProjects } from "../support/fixtures/restrict-to-projects";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("managing member project access", () => {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let app: TestApp;

  function putMemberProjectAccess(
    workspaceId: string,
    userId: string,
    body: { projectAccess: string; projectIds?: string[] },
  ) {
    return app.request(
      `/api/workspace/${workspaceId}/members/${userId}/project-access`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    for (const type of ["project_access.updated", "task.bulk_unassigned"]) {
      app
        .get(EventBus)
        .subscribe<Record<string, unknown>>(type, async (data) => {
          events.push({ type, data });
        });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    events.length = 0;
  });

  it("restricts a member and lifts the restriction again", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const member = await createMember(app.db, ctx.workspace.id);
    app.auth.signIn(ctx.owner);

    const restricted = await putMemberProjectAccess(
      ctx.workspace.id,
      member.id,
      { projectAccess: "selected", projectIds: [ctx.beta.id] },
    );
    expect(restricted.status).toBe(200);
    expect(await restricted.json()).toEqual({
      userId: member.id,
      projectAccess: "selected",
      projectIds: [ctx.beta.id],
    });
    expect(events).toEqual([
      {
        type: "project_access.updated",
        data: expect.objectContaining({
          workspaceId: ctx.workspace.id,
          userId: member.id,
          projectIds: [ctx.alpha.id],
        }),
      },
    ]);

    const listed = await app.request(
      `/api/workspace/${ctx.workspace.id}/project-access`,
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual(
      expect.arrayContaining([
        {
          userId: member.id,
          projectAccess: "selected",
          projectIds: [ctx.beta.id],
        },
        {
          userId: ctx.restricted.id,
          projectAccess: "selected",
          projectIds: [ctx.alpha.id],
        },
      ]),
    );

    const lifted = await putMemberProjectAccess(ctx.workspace.id, member.id, {
      projectAccess: "all",
    });
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toEqual({
      userId: member.id,
      projectAccess: "all",
      projectIds: [],
    });
    expect(
      await readMemberAccessRows(app.db, ctx.workspace.id, member.id),
    ).toEqual({ rules: [], grants: [] });
  });

  // Skipped: the GET /api/project/{id} half of the previous test; the project
  // routes are not ported yet.
  it.skip("blocks and reopens the member's project reads as the restriction changes", () => {});

  it("tells each member their own project access", async () => {
    const ctx = await createRestrictedWorkspace(app.db);

    app.auth.signIn(ctx.restricted);
    const restricted = await app.request(
      `/api/workspace/${ctx.workspace.id}/project-access/me`,
    );
    expect(restricted.status).toBe(200);
    expect(await restricted.json()).toEqual({
      userId: ctx.restricted.id,
      projectAccess: "selected",
      projectIds: [ctx.alpha.id],
    });

    app.auth.signIn(ctx.owner);
    const owner = await app.request(
      `/api/workspace/${ctx.workspace.id}/project-access/me`,
    );
    expect(await owner.json()).toMatchObject({ projectAccess: "all" });
  });

  it("refuses to restrict owners or yourself", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const admin = await createMember(app.db, ctx.workspace.id, "admin");
    app.auth.signIn(admin);

    const owner = await putMemberProjectAccess(ctx.workspace.id, ctx.owner.id, {
      projectAccess: "selected",
      projectIds: [ctx.alpha.id],
    });
    expect(owner.status).toBe(400);
    expect(await readErrorBody(owner)).toEqual({
      message: "Owners always have access to every project",
      code: "BAD_REQUEST",
    });

    const self = await putMemberProjectAccess(ctx.workspace.id, admin.id, {
      projectAccess: "selected",
      projectIds: [ctx.alpha.id],
    });
    expect(self.status).toBe(403);
    expect(await readErrorBody(self)).toEqual({
      message: "You can't change your own project access",
      code: "FORBIDDEN",
    });
    expect(events).toEqual([]);
  });

  it("requires permission to manage members", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const member = await createMember(app.db, ctx.workspace.id);
    app.auth.signIn(member);

    const listed = await app.request(
      `/api/workspace/${ctx.workspace.id}/project-access`,
    );
    expect(listed.status).toBe(403);
    expect(await readErrorBody(listed)).toEqual({
      message: "Insufficient permissions",
      code: "MISSING_PERMISSION",
      missingPermissions: ["member:update"],
    });
    expect(
      (
        await putMemberProjectAccess(ctx.workspace.id, ctx.restricted.id, {
          projectAccess: "all",
        })
      ).status,
    ).toBe(403);
    expect(
      (await readMemberAccessRows(app.db, ctx.workspace.id, ctx.restricted.id))
        .rules,
    ).toHaveLength(1);
  });

  it("stops a restricted admin from granting more than they can see", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const admin = await createMember(app.db, ctx.workspace.id, "admin");
    await restrictToProjects(app.db, ctx.workspace.id, admin.id, [
      ctx.alpha.id,
    ]);
    const unrestricted = await createMember(app.db, ctx.workspace.id);
    const member = await createMember(app.db, ctx.workspace.id);
    await restrictToProjects(app.db, ctx.workspace.id, member.id, [
      ctx.beta.id,
    ]);
    app.auth.signIn(admin);

    const hidden = await putMemberProjectAccess(ctx.workspace.id, member.id, {
      projectAccess: "selected",
      projectIds: [ctx.beta.id],
    });
    expect(hidden.status).toBe(403);

    const everything = await putMemberProjectAccess(
      ctx.workspace.id,
      member.id,
      { projectAccess: "all" },
    );
    expect(everything.status).toBe(403);

    const narrowed = await putMemberProjectAccess(
      ctx.workspace.id,
      unrestricted.id,
      { projectAccess: "selected", projectIds: [ctx.alpha.id] },
    );
    expect(narrowed.status).toBe(403);

    const visible = await putMemberProjectAccess(ctx.workspace.id, member.id, {
      projectAccess: "selected",
      projectIds: [ctx.alpha.id],
    });
    expect(visible.status).toBe(200);
    expect(
      ((await visible.json()) as { projectIds: string[] }).projectIds,
    ).toEqual([ctx.alpha.id]);
    const stored = await readMemberAccessRows(
      app.db,
      ctx.workspace.id,
      member.id,
    );
    expect(stored.grants.map((grant) => grant.projectId).sort()).toEqual(
      [ctx.alpha.id, ctx.beta.id].sort(),
    );

    const listed = await app.request(
      `/api/workspace/${ctx.workspace.id}/project-access`,
    );
    expect(listed.status).toBe(200);
    const entries = (await listed.json()) as {
      userId: string;
      projectIds: string[];
    }[];
    expect(JSON.stringify(entries)).not.toContain(ctx.beta.id);
    expect(entries.find((entry) => entry.userId === member.id)).toMatchObject({
      projectIds: [ctx.alpha.id],
    });
  });

  it("unassigns a member from tasks in projects they lose", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const member = await createMember(app.db, ctx.workspace.id);
    await app.db.update(
      TaskEntity,
      { id: ctx.betaTask.id },
      { userId: member.id },
    );
    app.auth.signIn(ctx.owner);

    const restricted = await putMemberProjectAccess(
      ctx.workspace.id,
      member.id,
      { projectAccess: "selected", projectIds: [ctx.alpha.id] },
    );

    expect(restricted.status).toBe(200);
    const task = await app.db.findOne(TaskEntity, {
      where: { id: ctx.betaTask.id },
    });
    expect(task?.userId).toBeNull();
    const activities = await app.db.find(ActivityEntity, {
      where: { taskId: ctx.betaTask.id },
    });
    expect(activities).toEqual([
      expect.objectContaining({
        type: "unassigned",
        userId: ctx.owner.id,
        content: null,
        eventData: {},
      }),
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "project_access.updated",
      "task.bulk_unassigned",
    ]);
    expect(events[1]?.data).toMatchObject({
      projectId: ctx.beta.id,
      userId: ctx.owner.id,
    });
  });

  it("rejects projects from another workspace", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const other = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.owner);

    const response = await putMemberProjectAccess(
      ctx.workspace.id,
      ctx.restricted.id,
      { projectAccess: "selected", projectIds: [other.alpha.id] },
    );

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toEqual({
      message: "Some selected projects don't belong to this workspace",
      code: "BAD_REQUEST",
    });
  });

  // Not in the previous suite: the remaining answers of the route.
  it("answers 404 for someone who is not a member and 400 for an unknown mode", async () => {
    const ctx = await createRestrictedWorkspace(app.db);
    const outsider = await createRestrictedWorkspace(app.db);
    app.auth.signIn(ctx.owner);

    const notMember = await putMemberProjectAccess(
      ctx.workspace.id,
      outsider.owner.id,
      { projectAccess: "all" },
    );
    expect(notMember.status).toBe(404);
    expect(await readErrorBody(notMember)).toEqual({
      message: "Member not found",
      code: "NOT_FOUND",
    });

    const invalid = await putMemberProjectAccess(
      ctx.workspace.id,
      ctx.restricted.id,
      { projectAccess: "some" },
    );
    expect(invalid.status).toBe(400);
    expect(await readErrorBody(invalid)).toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

// The previous suite read the invitee's projects from GET /api/project, which
// is not ported yet; these read the same access rule through
// `listAccessibleProjectIds`, and delete a project in the database.
describe("invitations with project access", () => {
  let app: TestApp;

  async function createInvitationWorkspace() {
    const owner = await signUpBrowser(app, "owner@example.com", "Owner");
    const created = await owner.post("/api/auth/organization/create", {
      name: "Agency",
      slug: "agency",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };
    const alpha = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
      name: "Alpha",
    });
    const beta = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
      name: "Beta",
    });
    return {
      owner,
      workspaceId: workspace.id,
      alpha: alpha.project,
      beta: beta.project,
    };
  }

  async function inviteAndAccept(
    ctx: Awaited<ReturnType<typeof createInvitationWorkspace>>,
    body: Record<string, unknown> & { email: string },
  ) {
    const invited = await ctx.owner.post("/api/auth/organization/invite-member", {
      organizationId: ctx.workspaceId,
      ...body,
    });
    expect(invited.status).toBe(200);
    const invitation = (await invited.json()) as { id: string };
    const invitee = await signUpBrowser(app, body.email);
    const accepted = await invitee.post(
      "/api/auth/organization/accept-invitation",
      { invitationId: invitation.id },
    );
    expect(accepted.status).toBe(200);
    return { invitation, invitee };
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

  it("applies the invitation's project selection when it's accepted", async () => {
    const ctx = await createInvitationWorkspace();

    const invited = await ctx.owner.post("/api/auth/organization/invite-member", {
      organizationId: ctx.workspaceId,
      email: "client@example.com",
      role: "member",
      projectAccess: "selected",
      projectIds: [ctx.alpha.id],
    });
    expect(invited.status).toBe(200);
    const invitation = (await invited.json()) as { id: string };
    expect(
      await app.db.findOneByOrFail(InvitationEntity, { id: invitation.id }),
    ).toMatchObject({ projectAccess: "selected", projectIds: [ctx.alpha.id] });

    const invitee = await signUpBrowser(app, "client@example.com", "Client");
    const accepted = await invitee.post(
      "/api/auth/organization/accept-invitation",
      { invitationId: invitation.id },
    );
    expect(accepted.status).toBe(200);

    const rows = await readMemberAccessRows(
      app.db,
      ctx.workspaceId,
      invitee.userId,
    );
    expect(rows.rules.map((rule) => rule.projectAccess)).toEqual(["selected"]);
    expect(rows.grants.map((grant) => grant.projectId)).toEqual([ctx.alpha.id]);
    expect([
      ...(await listAccessibleProjectIds(app.db, ctx.workspaceId, invitee.userId)),
    ]).toEqual([ctx.alpha.id]);

    const [membership] = await app.db.findBy(WorkspaceUserEntity, {
      userId: invitee.userId,
    });
    const removed = await ctx.owner.post("/api/auth/organization/remove-member", {
      organizationId: ctx.workspaceId,
      memberIdOrEmail: membership?.id,
    });
    expect(removed.status).toBe(200);
    expect(
      await readMemberAccessRows(app.db, ctx.workspaceId, invitee.userId),
    ).toEqual({ rules: [], grants: [] });
  });

  it("clears a member's project limit when they become an owner", async () => {
    const ctx = await createInvitationWorkspace();
    const { invitee } = await inviteAndAccept(ctx, {
      email: "lead@example.com",
      role: "member",
      projectAccess: "selected",
      projectIds: [ctx.alpha.id],
    });
    const [membership] = await app.db.findBy(WorkspaceUserEntity, {
      userId: invitee.userId,
    });

    const promoted = await ctx.owner.post(
      "/api/auth/organization/update-member-role",
      {
        organizationId: ctx.workspaceId,
        memberId: membership?.id,
        role: "owner",
      },
    );

    expect(promoted.status).toBe(200);
    expect(
      await readMemberAccessRows(app.db, ctx.workspaceId, invitee.userId),
    ).toEqual({ rules: [], grants: [] });
  });

  it("gives every project to an invitation without a selection", async () => {
    const ctx = await createInvitationWorkspace();

    const { invitee } = await inviteAndAccept(ctx, {
      email: "teammate@example.com",
      role: "member",
    });

    expect(
      (await listAccessibleProjectIds(app.db, ctx.workspaceId, invitee.userId))
        .size,
    ).toBe(2);
  });

  it("rejects an invitation for projects outside the workspace", async () => {
    const ctx = await createInvitationWorkspace();
    const other = await createRestrictedWorkspace(app.db);

    const invited = await ctx.owner.post("/api/auth/organization/invite-member", {
      organizationId: ctx.workspaceId,
      email: "client@example.com",
      role: "member",
      projectAccess: "selected",
      projectIds: [other.alpha.id],
    });

    expect(invited.status).toBe(400);
    expect(await readErrorBody(invited)).toEqual({
      code: "BAD_REQUEST",
      message: "Some selected projects don't belong to this workspace",
    });
    expect(await app.db.count(InvitationEntity)).toBe(0);
  });

  it("hides invited project ids from a limited admin", async () => {
    const ctx = await createInvitationWorkspace();
    const { invitee: admin } = await inviteAndAccept(ctx, {
      email: "admin@example.com",
      role: "admin",
      projectAccess: "selected",
      projectIds: [ctx.alpha.id],
    });
    const invited = await ctx.owner.post("/api/auth/organization/invite-member", {
      organizationId: ctx.workspaceId,
      email: "client@example.com",
      role: "member",
      projectAccess: "selected",
      projectIds: [ctx.alpha.id, ctx.beta.id],
    });
    expect(invited.status).toBe(200);

    const listed = await admin.get(
      `/api/auth/organization/list-invitations?organizationId=${ctx.workspaceId}`,
    );
    expect(listed.status).toBe(200);
    const invitations = (await listed.json()) as {
      email: string;
      projectIds: string[];
    }[];
    expect(
      invitations.find((invitation) => invitation.email === "client@example.com")
        ?.projectIds,
    ).toEqual([ctx.alpha.id]);
    expect(JSON.stringify(invitations)).not.toContain(ctx.beta.id);

    const full = await admin.get(
      `/api/auth/organization/get-full-organization?organizationId=${ctx.workspaceId}`,
    );
    expect(JSON.stringify(await full.json())).not.toContain(ctx.beta.id);
  });

  it("drops deleted projects from listed invitations", async () => {
    const ctx = await createInvitationWorkspace();
    await ctx.owner.post("/api/auth/organization/invite-member", {
      organizationId: ctx.workspaceId,
      email: "client@example.com",
      role: "member",
      projectAccess: "selected",
      projectIds: [ctx.alpha.id, ctx.beta.id],
    });
    await app.db.delete(ProjectEntity, { id: ctx.beta.id });

    const listed = await ctx.owner.get(
      `/api/auth/organization/list-invitations?organizationId=${ctx.workspaceId}`,
    );
    const [invitation] = (await listed.json()) as { projectIds: string[] }[];
    expect(invitation?.projectIds).toEqual([ctx.alpha.id]);
  });
});

// Skipped: needs the /api/notification-preferences routes, not ported yet.
describe("notification rules with project access", () => {
  it.skip("keeps projects a member lost when they save the rule again", () => {});
});
