import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createInvitation } from "../support/fixtures/create-invitation";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Not ported from the previous suite, which had no HTTP coverage for these
// routes: they pin the translated queries and the route wiring.
describe("API integration: invitation routes", () => {
  let app: TestApp;

  async function seedInviter() {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
      userName: "Inviter",
      workspaceName: "Agency",
    });
    return { inviterId: user.id, workspaceId: workspace.id };
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

  describe("GET /api/invitation/pending", () => {
    it("lists the caller's unexpired pending invitations, oldest first", async () => {
      const inviter = await seedInviter();
      const invitee = await createUser(app.db, {
        email: "invitee@example.com",
      });
      const older = await createInvitation(app.db, {
        ...inviter,
        email: invitee.email,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      const newer = await createInvitation(app.db, {
        ...(await seedInviter()),
        email: invitee.email,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      });
      await createInvitation(app.db, {
        ...inviter,
        email: invitee.email,
        status: "accepted",
      });
      await createInvitation(app.db, {
        ...inviter,
        email: invitee.email,
        status: "canceled",
      });
      await createInvitation(app.db, {
        ...inviter,
        email: invitee.email,
        expiresAt: new Date(Date.now() - 86_400_000),
      });
      await createInvitation(app.db, {
        ...inviter,
        email: "someone-else@example.com",
      });
      app.auth.signIn(invitee);

      const response = await app.request("/api/invitation/pending");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        {
          id: older.id,
          email: "invitee@example.com",
          workspaceId: inviter.workspaceId,
          workspaceName: "Agency",
          inviterName: "Inviter",
          expiresAt: older.expiresAt.toISOString(),
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "pending",
        },
        expect.objectContaining({ id: newer.id }),
      ]);
    });

    it("returns nothing until the caller's email is verified", async () => {
      const invitee = await createUser(app.db, { emailVerified: false });
      await createInvitation(app.db, {
        ...(await seedInviter()),
        email: invitee.email,
      });
      app.auth.signIn(invitee);

      const response = await app.request("/api/invitation/pending");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });

    it("returns nothing to an API key", async () => {
      const invitee = await createUser(app.db);
      await createInvitation(app.db, {
        ...(await seedInviter()),
        email: invitee.email,
      });
      app.auth.signInAs(await createApiKeyPrincipal(app.db, invitee));

      const response = await app.request("/api/invitation/pending");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });

    it("rejects missing credentials", async () => {
      app.auth.signOut();

      const response = await app.request("/api/invitation/pending");

      expect(response.status).toBe(401);
    });
  });

  describe.each([
    ["GET /api/invitation/{id}", "/api/invitation", true],
    ["GET /api/invitation/public/{id}", "/api/invitation/public", false],
  ])("%s", (_name, basePath, needsCaller) => {
    async function getDetails(id: string) {
      if (needsCaller) app.auth.signIn(await createUser(app.db));
      else app.auth.signOut();
      const response = await app.request(`${basePath}/${id}`);
      expect(response.status).toBe(200);
      return (await response.json()) as unknown;
    }

    it("describes an invitation that can still be accepted", async () => {
      const invitation = await createInvitation(app.db, {
        ...(await seedInviter()),
        email: "invitee@example.com",
      });

      expect(await getDetails(invitation.id)).toEqual({
        valid: true,
        invitation: {
          id: invitation.id,
          email: "invitee@example.com",
          workspaceName: "Agency",
          inviterName: "Inviter",
          expiresAt: invitation.expiresAt.toISOString(),
          status: "pending",
          expired: false,
        },
      });
    });

    it("reports an expired invitation with its details", async () => {
      const invitation = await createInvitation(app.db, {
        ...(await seedInviter()),
        email: "invitee@example.com",
        expiresAt: new Date(Date.now() - 86_400_000),
      });

      expect(await getDetails(invitation.id)).toEqual({
        valid: false,
        invitation: expect.objectContaining({
          id: invitation.id,
          expired: true,
        }),
        error: "This invitation has expired",
      });
    });

    it.each([
      ["accepted", "This invitation has already been accepted"],
      ["canceled", "This invitation has been canceled"],
    ])("withholds the details of a %s invitation", async (status, error) => {
      const invitation = await createInvitation(app.db, {
        ...(await seedInviter()),
        email: "invitee@example.com",
        status,
      });

      expect(await getDetails(invitation.id)).toEqual({ valid: false, error });
    });

    it("answers 200 for an unknown invitation", async () => {
      expect(await getDetails("missing")).toEqual({
        valid: false,
        error: "Invitation not found",
      });
    });
  });

  it("requires credentials for the documented lookup", async () => {
    app.auth.signOut();

    const response = await app.request("/api/invitation/some-id");

    expect(response.status).toBe(401);
  });
});
