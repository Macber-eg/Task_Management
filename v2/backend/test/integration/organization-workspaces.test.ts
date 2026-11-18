import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ApiError } from "../../src/common/errors/api-error";
import { InvitationEntity } from "../../src/database/entities/invitation.entity";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { TeamEntity } from "../../src/database/entities/team.entity";
import { TeamMemberEntity } from "../../src/database/entities/team-member.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { WorkspaceEntity } from "../../src/database/entities/workspace.entity";
import { WorkspaceRoleEntity } from "../../src/database/entities/workspace-role.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { EventBus } from "../../src/events/event-bus";
import { WorkspaceDeletionGuard } from "../../src/organization/workspaces/workspace-deletion-guard";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { type Browser, signUpBrowser } from "../support/browser";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createInvitation } from "../support/fixtures/create-invitation";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { realtimeDouble, resetRealtimeDouble } from "../support/realtime-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type WorkspaceBody = { id: string; name: string; slug: string };

describe("API integration: workspace (organization) endpoints", () => {
  const realtime = realtimeDouble();
  const assertDeletable = vi.fn<WorkspaceDeletionGuard["assertDeletable"]>();
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let app: TestApp;

  async function createWorkspace(browser: Browser, body: object) {
    const response = await browser.post("/api/auth/organization/create", body);
    expect(response.status).toBe(200);
    return (await response.json()) as WorkspaceBody & {
      members: { id: string; role: string; organizationId: string }[];
    };
  }

  async function activeOrganization(browser: Browser) {
    const session = await browser.get("/api/auth/get-session");
    return ((await session.json()) as {
      session: { activeOrganizationId: string | null; activeTeamId?: string };
    }).session.activeOrganizationId;
  }

  beforeAll(async () => {
    app = await createTestApp({
      realAuth: true,
      overrides: [
        [RealtimeConnections, realtime],
        [WorkspaceDeletionGuard, { assertDeletable }],
      ],
    });
    app.get(EventBus).subscribe<Record<string, unknown>>(
      "workspace.created",
      async (data) => {
        events.push({ type: "workspace.created", data });
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    resetRealtimeDouble(realtime);
    assertDeletable.mockReset().mockResolvedValue(undefined);
    events.length = 0;
    vi.unstubAllEnvs();
  });

  it("creates a workspace with its owner, default roles and team, and makes it active", async () => {
    const owner = await signUpBrowser(app, "owner@example.com", "Owner");

    const created = await createWorkspace(owner, {
      name: "Agency",
      slug: "agency",
      description: "Client work",
    });

    expect(created).toMatchObject({
      name: "Agency",
      slug: "agency",
      logo: null,
      description: "Client work",
      members: [{ userId: owner.userId, role: "owner" }],
    });
    expect(created).not.toHaveProperty("metadata");
    expect(created.members[0]?.organizationId).toBe(created.id);
    expect(created.members[0]).toHaveProperty("createdAt");

    const roles = await app.db.findBy(WorkspaceRoleEntity, {
      workspaceId: created.id,
    });
    expect(roles.map((role) => role.role).sort()).toEqual([
      "admin",
      "member",
      "viewer",
    ]);
    const [team] = await app.db.findBy(TeamEntity, { workspaceId: created.id });
    expect(team?.name).toBe("Agency");
    expect(
      await app.db.findBy(TeamMemberEntity, { teamId: team?.id }),
    ).toMatchObject([{ userId: owner.userId }]);

    const [session] = await app.db.findBy(SessionEntity, {
      userId: owner.userId,
    });
    expect(session).toMatchObject({
      activeOrganizationId: created.id,
      activeTeamId: team?.id,
    });
    expect(await activeOrganization(owner)).toBe(created.id);
    expect(events).toEqual([
      {
        type: "workspace.created",
        data: expect.objectContaining({
          workspaceId: created.id,
          workspaceName: "Agency",
          ownerEmail: "Owner",
          ownerId: owner.userId,
        }),
      },
    ]);
  });

  it("keeps the current workspace active when asked to, and parses metadata", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    const first = await createWorkspace(owner, { name: "First", slug: "first" });

    const second = await createWorkspace(owner, {
      name: "Second",
      slug: "second",
      metadata: { plan: "free" },
      keepCurrentActiveOrganization: true,
    });

    expect(second).toMatchObject({ metadata: { plan: "free" } });
    expect(await activeOrganization(owner)).toBe(first.id);
  });

  it("refuses a taken slug and an unsafe name", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    await createWorkspace(owner, { name: "Agency", slug: "agency" });

    const taken = await owner.post("/api/auth/organization/create", {
      name: "Other",
      slug: "agency",
    });
    expect(taken.status).toBe(400);
    expect(await readErrorBody(taken)).toEqual({
      code: "ORGANIZATION_ALREADY_EXISTS",
      message: "Organization already exists",
    });

    const phishing = await owner.post("/api/auth/organization/create", {
      name: "BANK OPER https://example.io/page2",
      slug: "bank",
    });
    expect(phishing.status).toBe(400);
    expect(await readErrorBody(phishing)).toEqual({
      code: "INVALID_WORKSPACE_NAME",
      message: "Workspace name may not contain URLs.",
    });
    expect(await app.db.count(WorkspaceEntity)).toBe(1);
  });

  it("lets only instance admins create workspaces when creation is disabled", async () => {
    const admin = await signUpBrowser(app, "admin@example.com");
    const user = await signUpBrowser(app, "user@example.com");
    vi.stubEnv("DISABLE_WORKSPACE_CREATION", "true");

    const refused = await user.post("/api/auth/organization/create", {
      name: "Mine",
      slug: "mine",
    });
    expect(refused.status).toBe(403);
    expect((await readErrorBody(refused)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION",
    );

    await createWorkspace(admin, { name: "Admin's", slug: "admins" });
  });

  it("checks a slug", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    await createWorkspace(owner, { name: "Agency", slug: "agency" });

    const free = await owner.post("/api/auth/organization/check-slug", {
      slug: "free",
    });
    expect(await free.json()).toEqual({ status: true });

    const taken = await owner.post("/api/auth/organization/check-slug", {
      slug: "agency",
    });
    expect(taken.status).toBe(400);
    expect((await readErrorBody(taken)).code).toBe(
      "ORGANIZATION_SLUG_ALREADY_TAKEN",
    );
  });

  it("lists the caller's workspaces, for a session and for an API key", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    const created = await createWorkspace(owner, { name: "Agency", slug: "agency" });
    await createWorkspaceMember(app.db);

    const listed = await owner.get("/api/auth/organization/list");
    expect(await listed.json()).toEqual([
      {
        id: created.id,
        name: "Agency",
        slug: "agency",
        logo: null,
        createdAt: expect.any(String),
        metadata: null,
        description: null,
      },
    ]);

    const { key } = await seedApiKey(app.db, owner.userId);
    const byKey = await app.request("/api/auth/organization/list", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(byKey.status).toBe(200);
    expect(
      ((await byKey.json()) as WorkspaceBody[]).map((workspace) => workspace.id),
    ).toEqual([created.id]);
  });

  it("updates a workspace for members allowed to, keeping slugs unique", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    const agency = await createWorkspace(owner, { name: "Agency", slug: "agency" });
    await createWorkspace(owner, { name: "Studio", slug: "studio" });

    const updated = await owner.post("/api/auth/organization/update", {
      organizationId: agency.id,
      data: { name: "Agency Ltd", metadata: { tier: 2 }, logo: null },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: agency.id,
      name: "Agency Ltd",
      metadata: { tier: 2 },
    });

    const clash = await owner.post("/api/auth/organization/update", {
      organizationId: agency.id,
      data: { slug: "studio" },
    });
    expect(clash.status).toBe(400);
    expect((await readErrorBody(clash)).code).toBe(
      "ORGANIZATION_SLUG_ALREADY_TAKEN",
    );

    const member = await signUpBrowser(app, "member@example.com");
    await addWorkspaceMember(app.db, agency.id, member.userId, "member");
    const refused = await member.post("/api/auth/organization/update", {
      organizationId: agency.id,
      data: { name: "Mine now" },
    });
    expect(refused.status).toBe(403);
    expect((await readErrorBody(refused)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION",
    );

    const outsider = await signUpBrowser(app, "outsider@example.com");
    const notMember = await outsider.post("/api/auth/organization/update", {
      organizationId: agency.id,
      data: { name: "Mine now" },
    });
    expect(notMember.status).toBe(400);
    expect((await readErrorBody(notMember)).code).toBe(
      "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
    );
  });

  it("sets, re-checks and clears the active workspace", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    const first = await createWorkspace(owner, { name: "First", slug: "first" });
    const second = await createWorkspace(owner, { name: "Second", slug: "second" });
    expect(await activeOrganization(owner)).toBe(second.id);

    const bySlug = await owner.post("/api/auth/organization/set-active", {
      organizationSlug: "first",
    });
    expect(await bySlug.json()).toMatchObject({ id: first.id, metadata: null });
    expect(await activeOrganization(owner)).toBe(first.id);

    const current = await owner.post("/api/auth/organization/set-active", {});
    expect(await current.json()).toMatchObject({ id: first.id });

    const cleared = await owner.post("/api/auth/organization/set-active", {
      organizationId: null,
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toBeNull();
    expect(await activeOrganization(owner)).toBeNull();

    const missing = await owner.post("/api/auth/organization/set-active", {
      organizationSlug: "nope",
    });
    expect(missing.status).toBe(400);
    expect((await readErrorBody(missing)).code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("refuses to activate a workspace the caller is not in, and clears the active one", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    const mine = await createWorkspace(owner, { name: "Mine", slug: "mine" });
    const other = await createWorkspaceMember(app.db);

    const refused = await owner.post("/api/auth/organization/set-active", {
      organizationId: other.workspace.id,
    });
    expect(refused.status).toBe(403);
    expect((await readErrorBody(refused)).code).toBe(
      "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
    );
    expect(await activeOrganization(owner)).toBeNull();
    expect(mine.id).toBeTruthy();
  });

  it("returns the full workspace with members, invitations and teams", async () => {
    const owner = await signUpBrowser(app, "owner@example.com", "Owner");
    const created = await createWorkspace(owner, { name: "Agency", slug: "agency" });
    const invitation = await createInvitation(app.db, {
      workspaceId: created.id,
      inviterId: owner.userId,
      email: "guest@example.com",
    });

    const full = await owner.get(
      `/api/auth/organization/get-full-organization?organizationSlug=agency&membersLimit=10`,
    );
    expect(full.status).toBe(200);
    expect(await full.json()).toMatchObject({
      id: created.id,
      name: "Agency",
      members: [
        {
          userId: owner.userId,
          role: "owner",
          organizationId: created.id,
          user: { id: owner.userId, name: "Owner", email: "owner@example.com" },
        },
      ],
      invitations: [
        {
          id: invitation.id,
          email: "guest@example.com",
          organizationId: created.id,
          projectIds: [],
        },
      ],
      teams: [{ name: "Agency", organizationId: created.id }],
    });

    const active = await owner.get("/api/auth/organization/get-full-organization");
    expect(((await active.json()) as WorkspaceBody).id).toBe(created.id);
  });

  it("answers null without a workspace, and 403 for someone else's", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    const none = await owner.get("/api/auth/organization/get-full-organization");
    expect(none.status).toBe(200);
    expect(await none.json()).toBeNull();

    const other = await createWorkspaceMember(app.db);
    const refused = await owner.get(
      `/api/auth/organization/get-full-organization?organizationId=${other.workspace.id}`,
    );
    expect(refused.status).toBe(403);
    expect((await readErrorBody(refused)).code).toBe(
      "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
    );

    const unknown = await owner.get(
      "/api/auth/organization/get-full-organization?organizationId=missing",
    );
    expect(unknown.status).toBe(400);
    expect((await readErrorBody(unknown)).code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("deletes a workspace and revokes its members and the instance admins", async () => {
    const admin = await signUpBrowser(app, "admin@example.com");
    const owner = await signUpBrowser(app, "owner@example.com");
    const created = await createWorkspace(owner, { name: "Doomed", slug: "doomed" });
    const member = await signUpBrowser(app, "member@example.com");
    await addWorkspaceMember(app.db, created.id, member.userId);
    await createInvitation(app.db, {
      workspaceId: created.id,
      inviterId: owner.userId,
      email: "guest@example.com",
    });

    const deleted = await owner.post("/api/auth/organization/delete", {
      organizationId: created.id,
    });

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      id: created.id,
      name: "Doomed",
      metadata: null,
    });
    expect(assertDeletable).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id, name: "Doomed" }),
    );
    expect(await app.db.countBy(WorkspaceEntity, { id: created.id })).toBe(0);
    expect(
      await app.db.countBy(WorkspaceUserEntity, { workspaceId: created.id }),
    ).toBe(0);
    expect(
      await app.db.countBy(InvitationEntity, { workspaceId: created.id }),
    ).toBe(0);
    expect(await activeOrganization(owner)).toBeNull();
    const revoked = realtime.revokeWorkspaceConnections.mock.calls;
    expect(revoked.map(([userId]) => userId).sort()).toEqual(
      [admin.userId, owner.userId, member.userId].sort(),
    );
    for (const [, workspaceId, options] of revoked) {
      expect(workspaceId).toBe(created.id);
      expect(options).toEqual({ force: true });
    }
  });

  it("refuses to delete while billing says no, and for members without the permission", async () => {
    const owner = await signUpBrowser(app, "owner@example.com");
    const created = await createWorkspace(owner, { name: "Paid", slug: "paid" });
    assertDeletable.mockRejectedValueOnce(
      new ApiError(409, {
        code: "WORKSPACE_HAS_ACTIVE_SUBSCRIPTION",
        message:
          '"Paid" still has an active subscription. Cancel it in billing settings before deleting.',
      }),
    );

    const paid = await owner.post("/api/auth/organization/delete", {
      organizationId: created.id,
    });
    expect(paid.status).toBe(409);
    expect(await paid.text()).toMatch(/active subscription/);
    expect(await app.db.countBy(WorkspaceEntity, { id: created.id })).toBe(1);

    const admin = await signUpBrowser(app, "workspace-admin@example.com");
    await addWorkspaceMember(app.db, created.id, admin.userId, "admin");
    const refused = await admin.post("/api/auth/organization/delete", {
      organizationId: created.id,
    });
    expect(refused.status).toBe(403);
    expect((await readErrorBody(refused)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION",
    );
  });

  it("requires a signed-in caller", async () => {
    const response = await app.request("/api/auth/organization/list");
    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
    expect(await app.db.count(UserEntity)).toBe(0);
  });
});
