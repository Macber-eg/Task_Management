import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { InvitationEntity } from "../../src/database/entities/invitation.entity";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { EventBus } from "../../src/events/event-bus";
import { InvitationMailer } from "../../src/organization/invitations/invitation-mailer";
import { type Browser, signUpBrowser } from "../support/browser";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createInvitation } from "../support/fixtures/create-invitation";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  organizationId: string;
  expiresAt: string;
};

describe("API integration: workspace invitations", () => {
  const sendInvitation = vi.fn<InvitationMailer["sendInvitation"]>();
  const events: { type: string; data: Record<string, unknown> }[] = [];
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

  async function invite(browser: Browser, body: Record<string, unknown>) {
    return browser.post("/api/auth/organization/invite-member", body);
  }

  async function invited(browser: Browser, body: Record<string, unknown>) {
    const response = await invite(browser, body);
    expect(response.status).toBe(200);
    return (await response.json()) as Invitation;
  }

  beforeAll(async () => {
    app = await createTestApp({
      realAuth: true,
      overrides: [[InvitationMailer, { sendInvitation }]],
    });
    app
      .get(EventBus)
      .subscribe<Record<string, unknown>>(
        "project_members.updated",
        async (data) => {
          events.push({ type: "project_members.updated", data });
        },
      );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    sendInvitation.mockReset().mockResolvedValue(undefined);
    events.length = 0;
    vi.unstubAllEnvs();
  });

  it("invites an address, stores the invitation and emails it", async () => {
    const { owner, workspaceId } = await ownedWorkspace();

    const invitation = await invited(owner, {
      email: "Client@Example.com",
      role: "member",
    });

    expect(invitation).toEqual({
      id: expect.any(String),
      organizationId: workspaceId,
      email: "client@example.com",
      role: "member",
      teamId: null,
      status: "pending",
      expiresAt: expect.any(String),
      createdAt: expect.any(String),
      inviterId: owner.userId,
      projectAccess: "all",
      projectIds: [],
    });
    const lifetime = new Date(invitation.expiresAt).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
    expect(sendInvitation).toHaveBeenCalledWith({
      invitation: expect.objectContaining({ id: invitation.id }),
      workspace: expect.objectContaining({ id: workspaceId, name: "Agency" }),
      inviter: expect.objectContaining({ id: owner.userId }),
    });
  });

  it("refuses duplicates and members, and renews on resend", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const first = await invited(owner, {
      email: "client@example.com",
      role: "member",
    });

    const again = await invite(owner, {
      email: "client@example.com",
      role: "member",
    });
    expect(again.status).toBe(400);
    expect((await readErrorBody(again)).code).toBe(
      "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
    );

    const resent = await invited(owner, {
      email: "client@example.com",
      role: "admin",
      resend: true,
    });
    expect(resent.id).toBe(first.id);
    expect(resent.role).toBe("member");
    expect(new Date(resent.expiresAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.expiresAt).getTime(),
    );
    expect(sendInvitation).toHaveBeenCalledTimes(2);

    const member = await signUpBrowser(app, "member@example.com");
    await addWorkspaceMember(app.db, workspaceId, member.userId);
    const existing = await invite(owner, {
      email: "member@example.com",
      role: "member",
    });
    expect(existing.status).toBe(400);
    expect((await readErrorBody(existing)).code).toBe(
      "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
    );
    expect(await app.db.count(InvitationEntity)).toBe(1);
  });

  it("validates the address, the role and who may grant it", async () => {
    const { owner, workspaceId } = await ownedWorkspace();

    const badEmail = await invite(owner, { email: "not-an-email", role: "member" });
    expect(badEmail.status).toBe(400);
    expect((await readErrorBody(badEmail)).code).toBe("INVALID_EMAIL");

    const unknownRole = await invite(owner, {
      email: "a@example.com",
      role: ["member", "wizard"],
    });
    expect(unknownRole.status).toBe(400);
    expect((await readErrorBody(unknownRole)).message).toBe(
      "ROLE_NOT_FOUND: wizard",
    );

    const viewer = await invited(owner, { email: "v@example.com", role: "viewer" });
    expect(viewer.role).toBe("viewer");

    const admin = await signUpBrowser(app, "admin@example.com");
    await addWorkspaceMember(app.db, workspaceId, admin.userId, "admin");
    const ownerInvite = await invite(admin, {
      organizationId: workspaceId,
      email: "boss@example.com",
      role: "owner",
    });
    expect(ownerInvite.status).toBe(403);
    expect((await readErrorBody(ownerInvite)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE",
    );

    const plain = await signUpBrowser(app, "plain@example.com");
    await addWorkspaceMember(app.db, workspaceId, plain.userId, "member");
    const notAllowed = await invite(plain, {
      organizationId: workspaceId,
      email: "friend@example.com",
      role: "member",
    });
    expect(notAllowed.status).toBe(403);
    expect((await readErrorBody(notAllowed)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
    );

    const outsider = await signUpBrowser(app, "outsider@example.com");
    const notMember = await invite(outsider, {
      organizationId: workspaceId,
      email: "friend@example.com",
      role: "member",
    });
    expect(notMember.status).toBe(400);
    expect((await readErrorBody(notMember)).code).toBe("MEMBER_NOT_FOUND");
  });

  it("reports failed send and resend, keeps the pending invitation, and allows retry", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    sendInvitation.mockRejectedValue(new Error("private SMTP error"));
    const body = {
      organizationId: workspaceId,
      email: "invitee@example.com",
      role: "member",
    };

    const failed = await invite(owner, body);
    expect(failed.status).toBe(502);
    expect(await readErrorBody(failed)).toEqual({
      code: "INVITATION_EMAIL_FAILED",
      message:
        "Invitation saved, but email delivery failed. Check SMTP settings and resend the invitation.",
    });
    expect(await app.db.count(InvitationEntity)).toBe(1);

    expect((await invite(owner, { ...body, resend: true })).status).toBe(502);
    sendInvitation.mockResolvedValue(undefined);
    expect((await invite(owner, { ...body, resend: true })).status).toBe(200);
    expect(await app.db.count(InvitationEntity)).toBe(1);
  });

  it("blocks guest inviters and disposable invitees on cloud only", async () => {
    const { owner } = await ownedWorkspace();
    vi.stubEnv("KANEO_CLOUD", "true");

    const disposable = await invite(owner, {
      email: "x@mailinator.com",
      role: "member",
    });
    expect(disposable.status).toBe(400);
    expect((await readErrorBody(disposable)).code).toBe(
      "DISPOSABLE_EMAIL_NOT_ALLOWED",
    );

    await app.db.update(UserEntity, { id: owner.userId }, { isAnonymous: true });
    const guest = await invite(owner, {
      email: "teammate@example.com",
      role: "member",
    });
    expect(guest.status).toBe(403);
    expect((await readErrorBody(guest)).code).toBe(
      "GUEST_INVITATIONS_NOT_ALLOWED",
    );

    vi.stubEnv("KANEO_CLOUD", "false");
    await invited(owner, { email: "x@mailinator.com", role: "member" });
  });

  it("accepts an invitation into a membership and the active workspace", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const invitation = await invited(owner, {
      email: "client@example.com",
      role: "admin",
    });
    const someoneElse = await signUpBrowser(app, "else@example.com");
    const wrong = await someoneElse.post(
      "/api/auth/organization/accept-invitation",
      { invitationId: invitation.id },
    );
    expect(wrong.status).toBe(403);
    expect((await readErrorBody(wrong)).code).toBe(
      "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
    );

    const invitee = await signUpBrowser(app, "client@example.com", "Client");
    const accepted = await invitee.post(
      "/api/auth/organization/accept-invitation",
      { invitationId: invitation.id },
    );

    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as {
      invitation: Invitation;
      member: { id: string; userId: string; role: string };
    };
    expect(body.invitation).toMatchObject({ id: invitation.id, status: "accepted" });
    expect(body.member).toMatchObject({
      userId: invitee.userId,
      organizationId: workspaceId,
      role: "admin",
    });
    expect(
      await app.db.countBy(WorkspaceUserEntity, {
        workspaceId,
        userId: invitee.userId,
      }),
    ).toBe(1);
    const [session] = await app.db.findBy(SessionEntity, {
      userId: invitee.userId,
    });
    expect(session?.activeOrganizationId).toBe(workspaceId);
    expect(events).toContainEqual({
      type: "project_members.updated",
      data: expect.objectContaining({ workspaceId }),
    });

    const twice = await invitee.post("/api/auth/organization/accept-invitation", {
      invitationId: invitation.id,
    });
    expect(twice.status).toBe(400);
    expect((await readErrorBody(twice)).code).toBe("INVITATION_NOT_FOUND");
  });

  it("refuses an expired invitation", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const expired = await createInvitation(app.db, {
      workspaceId,
      inviterId: owner.userId,
      email: "late@example.com",
      expiresAt: new Date(Date.now() - 1000),
    });
    const invitee = await signUpBrowser(app, "late@example.com");

    const response = await invitee.post(
      "/api/auth/organization/accept-invitation",
      { invitationId: expired.id },
    );

    expect(response.status).toBe(400);
    expect((await readErrorBody(response)).code).toBe("INVITATION_NOT_FOUND");
  });

  it("rejects an invitation", async () => {
    const { owner } = await ownedWorkspace();
    const invitation = await invited(owner, {
      email: "client@example.com",
      role: "member",
    });
    const invitee = await signUpBrowser(app, "client@example.com");

    const rejected = await invitee.post(
      "/api/auth/organization/reject-invitation",
      { invitationId: invitation.id },
    );
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({
      invitation: { id: invitation.id, status: "rejected" },
      member: null,
    });

    const again = await invitee.post("/api/auth/organization/reject-invitation", {
      invitationId: invitation.id,
    });
    expect(again.status).toBe(400);
    expect(await readErrorBody(again)).toEqual({
      code: "INVITATION_NOT_FOUND",
      message: "Invitation not found!",
    });
  });

  it("cancels an invitation for members allowed to", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const invitation = await invited(owner, {
      email: "client@example.com",
      role: "member",
    });
    const plain = await signUpBrowser(app, "plain@example.com");
    await addWorkspaceMember(app.db, workspaceId, plain.userId, "member");

    const refused = await plain.post("/api/auth/organization/cancel-invitation", {
      invitationId: invitation.id,
    });
    expect(refused.status).toBe(403);
    expect((await readErrorBody(refused)).code).toBe(
      "YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION",
    );

    const canceled = await owner.post("/api/auth/organization/cancel-invitation", {
      invitationId: invitation.id,
    });
    expect(canceled.status).toBe(200);
    expect(await canceled.json()).toMatchObject({
      id: invitation.id,
      status: "canceled",
    });

    const missing = await owner.post("/api/auth/organization/cancel-invitation", {
      invitationId: "missing",
    });
    expect(missing.status).toBe(400);
    expect((await readErrorBody(missing)).code).toBe("INVITATION_NOT_FOUND");
  });

  it("shows an invitation to its recipient only", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    const invitation = await invited(owner, {
      email: "client@example.com",
      role: "member",
    });
    const path = `/api/auth/organization/get-invitation?id=${invitation.id}`;

    const anonymous = await app.request(path);
    expect(anonymous.status).toBe(401);
    expect((await readErrorBody(anonymous)).message).toBe("Not authenticated");

    const invitee = await signUpBrowser(app, "client@example.com");
    const shown = await invitee.get(path);
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({
      id: invitation.id,
      organizationId: workspaceId,
      organizationName: "Agency",
      organizationSlug: "agency",
      inviterEmail: "owner@example.com",
    });

    const other = await signUpBrowser(app, "other@example.com");
    const refused = await other.get(path);
    expect(refused.status).toBe(403);

    const unknown = await invitee.get(
      "/api/auth/organization/get-invitation?id=missing",
    );
    expect(unknown.status).toBe(400);
    expect((await readErrorBody(unknown)).message).toBe("Invitation not found!");
  });

  it("lists a workspace's invitations for its members", async () => {
    const { owner, workspaceId } = await ownedWorkspace();
    await invited(owner, { email: "a@example.com", role: "member" });
    const canceled = await invited(owner, { email: "b@example.com", role: "member" });
    await owner.post("/api/auth/organization/cancel-invitation", {
      invitationId: canceled.id,
    });

    const listed = await owner.get(
      `/api/auth/organization/list-invitations?organizationId=${workspaceId}`,
    );
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as Invitation[])
        .map((invitation) => `${invitation.email}:${invitation.status}`)
        .sort(),
    ).toEqual(["a@example.com:pending", "b@example.com:canceled"]);

    const outsider = await signUpBrowser(app, "outsider@example.com");
    const refused = await outsider.get(
      `/api/auth/organization/list-invitations?organizationId=${workspaceId}`,
    );
    expect(refused.status).toBe(403);
    expect((await readErrorBody(refused)).message).toBe(
      "You are not a member of this organization",
    );
  });

  it("lists the pending invitations addressed to a verified user", async () => {
    const { owner } = await ownedWorkspace();
    await invited(owner, { email: "client@example.com", role: "member" });
    const invitee = await signUpBrowser(app, "client@example.com");
    const path = "/api/auth/organization/list-user-invitations";

    const unverified = await invitee.get(path);
    expect(unverified.status).toBe(403);
    expect((await readErrorBody(unverified)).code).toBe(
      "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION",
    );

    await app.db.update(
      UserEntity,
      { id: invitee.userId },
      { emailVerified: true },
    );
    const listed = await invitee.get(path);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject([
      { email: "client@example.com", status: "pending", organizationName: "Agency" },
    ]);

    const byEmail = await invitee.get(`${path}?email=client@example.com`);
    expect(byEmail.status).toBe(400);

    const anonymous = await app.request(path);
    expect(anonymous.status).toBe(400);
    expect((await readErrorBody(anonymous)).message).toBe(
      "Missing session headers, or email query parameter.",
    );
  });
});
