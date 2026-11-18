import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { TeamEntity } from "../../src/database/entities/team.entity";
import { TeamMemberEntity } from "../../src/database/entities/team-member.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { EventBus } from "../../src/events/event-bus";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { type Browser, signUpBrowser } from "../support/browser";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { insertRow } from "../support/fixtures/insert-row";
import { readMemberAccessRows } from "../support/fixtures/read-member-access-rows";
import { restrictToProjects } from "../support/fixtures/restrict-to-projects";
import { readErrorBody } from "../support/read-error-body";
import { realtimeDouble, resetRealtimeDouble } from "../support/realtime-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type Member = {
  id: string;
  userId: string;
  role: string;
  organizationId: string;
  user?: { email: string };
};

describe("API integration: workspace member endpoints", () => {
  const realtime = realtimeDouble();
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let app: TestApp;

  /** An owner (the instance's first user) in a workspace they created. */
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

  async function join(workspaceId: string, email: string, role = "member") {
    const browser = await signUpBrowser(app, email, email.split("@")[0]);
    const member = await addWorkspaceMember(
      app.db,
      workspaceId,
      browser.userId,
      role,
    );
    return { browser, member };
  }

  async function members(browser: Browser, query: string) {
    const response = await browser.get(
      `/api/auth/organization/list-members?${query}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { members: Member[]; total: number };
  }

  beforeAll(async () => {
    app = await createTestApp({
      realAuth: true,
      overrides: [[RealtimeConnections, realtime]],
    });
    for (const type of ["project_members.updated", "project_access.updated"]) {
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
    resetRealtimeDouble(realtime);
    events.length = 0;
  });

  it("lists members with their users, paged, sorted and filtered", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    await join(workspaceId, "ada@example.com", "admin");
    await join(workspaceId, "bo@example.com");

    const all = await members(owner, `organizationId=${workspaceId}`);
    expect(all.total).toBe(3);
    expect(all.members).toHaveLength(3);
    expect(all.members.find((member) => member.role === "owner")).toMatchObject({
      userId: owner.userId,
      organizationId: workspaceId,
      user: { email: "owner@example.com" },
    });

    const page = await members(
      owner,
      `organizationId=${workspaceId}&limit=1&offset=1&sortBy=role&sortDirection=asc`,
    );
    expect(page.total).toBe(3);
    expect(page.members.map((member) => member.role)).toEqual(["member"]);

    const admins = await members(
      owner,
      `organizationId=${workspaceId}&filterField=role&filterValue=admin`,
    );
    expect(admins).toMatchObject({
      total: 1,
      members: [{ user: { email: "ada@example.com" } }],
    });

    const active = await members(owner, "");
    expect(active.total).toBe(3);
  });

  it("refuses to list another workspace's members", async () => {
    const { workspaceId } = await ownedWorkspace();
    const outsider = await signUpBrowser(app, "outsider@example.com");

    const response = await outsider.get(
      `/api/auth/organization/list-members?organizationId=${workspaceId}`,
    );
    expect(response.status).toBe(403);
    expect((await readErrorBody(response)).code).toBe(
      "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION",
    );

    const noActive = await outsider.get("/api/auth/organization/list-members");
    expect(noActive.status).toBe(400);
    expect((await readErrorBody(noActive)).code).toBe("NO_ACTIVE_ORGANIZATION");
  });

  it("answers the active member and roles", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const { member } = await join(workspaceId, "ada@example.com", "admin");

    const active = await owner.get("/api/auth/organization/get-active-member");
    expect(await active.json()).toMatchObject({
      userId: owner.userId,
      role: "owner",
      organizationId: workspaceId,
      user: { email: "owner@example.com" },
    });

    const mine = await owner.get("/api/auth/organization/get-active-member-role");
    expect(await mine.json()).toEqual({ role: "owner" });

    const theirs = await owner.get(
      `/api/auth/organization/get-active-member-role?userId=${member.userId}&organizationSlug=agency`,
    );
    expect(await theirs.json()).toEqual({ role: "admin" });

    const stranger = await owner.get(
      "/api/auth/organization/get-active-member-role?userId=nobody",
    );
    expect(stranger.status).toBe(403);
  });

  it("transfers ownership: promote another member, then step down", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const { member } = await join(workspaceId, "next@example.com", "admin");
    const [ownerMembership] = await app.db.findBy(WorkspaceUserEntity, {
      userId: owner.userId,
    });

    const promoted = await owner.post("/api/auth/organization/update-member-role", {
      organizationId: workspaceId,
      memberId: member.id,
      role: "owner",
    });
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toEqual({
      id: member.id,
      userId: member.userId,
      organizationId: workspaceId,
      role: "owner",
      createdAt: expect.any(String),
    });
    expect(events).toContainEqual({
      type: "project_access.updated",
      data: expect.objectContaining({ workspaceId, userId: member.userId }),
    });

    const demoted = await owner.post("/api/auth/organization/update-member-role", {
      organizationId: workspaceId,
      memberId: ownerMembership?.id,
      role: ["admin"],
    });
    expect(demoted.status).toBe(200);
    expect(await demoted.json()).toMatchObject({ role: "admin" });
  });

  it("guards member role changes", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const [ownerMembership] = await app.db.findBy(WorkspaceUserEntity, {
      userId: owner.userId,
    });
    const admin = await join(workspaceId, "admin@example.com", "admin");
    const plain = await join(workspaceId, "plain@example.com");

    const lastOwner = await owner.post("/api/auth/organization/update-member-role", {
      memberId: ownerMembership?.id,
      role: "admin",
    });
    expect(lastOwner.status).toBe(400);
    expect((await readErrorBody(lastOwner)).code).toBe(
      "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
    );

    const makeOwner = await admin.browser.post(
      "/api/auth/organization/update-member-role",
      { organizationId: workspaceId, memberId: plain.member.id, role: "owner" },
    );
    expect(makeOwner.status).toBe(403);
    expect((await readErrorBody(makeOwner)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER",
    );

    const unknown = await owner.post("/api/auth/organization/update-member-role", {
      memberId: plain.member.id,
      role: "wizard,admin",
    });
    expect(unknown.status).toBe(400);
    expect(await readErrorBody(unknown)).toEqual({
      code: "ROLE_NOT_FOUND",
      message: "ROLE_NOT_FOUND: wizard",
    });

    const byMember = await plain.browser.post(
      "/api/auth/organization/update-member-role",
      { organizationId: workspaceId, memberId: admin.member.id, role: "member" },
    );
    expect(byMember.status).toBe(403);

    const viewer = await admin.browser.post(
      "/api/auth/organization/update-member-role",
      { organizationId: workspaceId, memberId: plain.member.id, role: "viewer" },
    );
    expect(viewer.status).toBe(200);
  });

  it("removes a member by id or email, cleaning up access and teams", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const { project } = await createProjectFixture(app.db, { workspaceId });
    const byId = await join(workspaceId, "first@example.com");
    const byEmail = await join(workspaceId, "second@example.com");
    await restrictToProjects(app.db, workspaceId, byId.member.userId, [
      project.id,
    ]);
    const [team] = await app.db.findBy(TeamEntity, { workspaceId });
    await insertRow(app.db, TeamMemberEntity, {
      teamId: team?.id,
      userId: byId.member.userId,
    });

    const removed = await owner.post("/api/auth/organization/remove-member", {
      organizationId: workspaceId,
      memberIdOrEmail: byId.member.id,
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      member: {
        id: byId.member.id,
        userId: byId.member.userId,
        organizationId: workspaceId,
        role: "member",
        createdAt: expect.any(String),
      },
    });
    expect(
      await readMemberAccessRows(app.db, workspaceId, byId.member.userId),
    ).toEqual({ rules: [], grants: [] });
    expect(
      await app.db.countBy(TeamMemberEntity, { userId: byId.member.userId }),
    ).toBe(0);
    expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
      byId.member.userId,
      workspaceId,
      { role: null },
    );

    const removedByEmail = await owner.post(
      "/api/auth/organization/remove-member",
      { memberIdOrEmail: "SECOND@example.com" },
    );
    expect(removedByEmail.status).toBe(200);
    expect(await removedByEmail.json()).toMatchObject({
      member: { id: byEmail.member.id, user: { email: "second@example.com" } },
    });
    expect(await app.db.countBy(WorkspaceUserEntity, { workspaceId })).toBe(1);
  });

  it("guards member removal", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const [ownerMembership] = await app.db.findBy(WorkspaceUserEntity, {
      userId: owner.userId,
    });
    const plain = await join(workspaceId, "plain@example.com");
    const other = await join(workspaceId, "other@example.com");

    const onlyOwner = await owner.post("/api/auth/organization/remove-member", {
      memberIdOrEmail: ownerMembership?.id,
    });
    expect(onlyOwner.status).toBe(400);
    expect((await readErrorBody(onlyOwner)).code).toBe(
      "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
    );

    const notAllowed = await plain.browser.post(
      "/api/auth/organization/remove-member",
      { organizationId: workspaceId, memberIdOrEmail: other.member.id },
    );
    expect(notAllowed.status).toBe(401);
    expect((await readErrorBody(notAllowed)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER",
    );

    const missing = await owner.post("/api/auth/organization/remove-member", {
      memberIdOrEmail: "nobody@example.com",
    });
    expect(missing.status).toBe(400);
    expect((await readErrorBody(missing)).code).toBe("MEMBER_NOT_FOUND");
  });

  it("lets a member leave, revoking their sockets and clearing the active workspace", async () => {
    const { workspaceId } = await ownedWorkspace();
    const { browser, member } = await join(workspaceId, "leaver@example.com");
    const { project } = await createProjectFixture(app.db, { workspaceId });
    await restrictToProjects(app.db, workspaceId, member.userId, [project.id]);
    await app.db.update(
      SessionEntity,
      { userId: member.userId },
      { activeOrganizationId: workspaceId },
    );

    const left = await browser.post("/api/auth/organization/leave", {
      organizationId: workspaceId,
    });

    expect(left.status).toBe(200);
    expect(await left.json()).toMatchObject({
      id: member.id,
      userId: member.userId,
      organizationId: workspaceId,
      user: { email: "leaver@example.com" },
    });
    expect(
      await app.db.countBy(WorkspaceUserEntity, { userId: member.userId }),
    ).toBe(0);
    expect(
      await readMemberAccessRows(app.db, workspaceId, member.userId),
    ).toEqual({ rules: [], grants: [] });
    expect(realtime.revokeWorkspaceConnections).toHaveBeenCalledWith(
      member.userId,
      workspaceId,
      { role: null },
    );
    const [session] = await app.db.findBy(SessionEntity, {
      userId: member.userId,
    });
    expect(session?.activeOrganizationId).toBeNull();
  });

  it("keeps the last owner from leaving", async () => {
    const { owner, workspaceId } = await ownedWorkspace();

    const response = await owner.post("/api/auth/organization/leave", {
      organizationId: workspaceId,
    });

    expect(response.status).toBe(400);
    expect((await readErrorBody(response)).code).toBe(
      "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
    );
    expect(realtime.revokeWorkspaceConnections).not.toHaveBeenCalled();
  });
});
