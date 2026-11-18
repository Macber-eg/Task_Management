import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { checkRegistrationAllowed } from "../../src/auth/registration/check-registration-allowed";
import { createInvitation } from "../support/fixtures/create-invitation";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: invite-only registration", () => {
  let app: TestApp;

  async function seedInvitation(
    email: string,
    overrides?: Partial<{ status: string; expiresAt: Date }>,
  ) {
    const inviter = await createWorkspaceMember(app.db, { role: "owner" });
    return createInvitation(app.db, {
      workspaceId: inviter.workspace.id,
      inviterId: inviter.user.id,
      email,
      ...overrides,
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
    vi.stubEnv("DISABLE_REGISTRATION", "true");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("allows an OAuth signup whose verified email has a pending invitation", async () => {
    const email = `invited-${randomUUID()}@example.com`;
    const invitation = await seedInvitation(email);

    const result = await checkRegistrationAllowed(app.db, email, undefined, {
      allowInvitationByEmail: true,
      emailVerified: true,
    });

    expect(result.allowed).toBe(true);
    expect(result.invitation?.id).toBe(invitation.id);
  });

  it.each([false, undefined])(
    "rejects an unverified provider email (%s)",
    async (emailVerified) => {
      const email = `invited-${randomUUID()}@example.com`;
      await seedInvitation(email);
      const result = await checkRegistrationAllowed(app.db, email, undefined, {
        allowInvitationByEmail: true,
        emailVerified,
      });
      expect(result.allowed).toBe(false);
    },
  );

  it("matches the invitation regardless of email casing", async () => {
    const email = `invited-${randomUUID()}@example.com`;
    await seedInvitation(email);

    const result = await checkRegistrationAllowed(
      app.db,
      email.toUpperCase(),
      undefined,
      {
        allowInvitationByEmail: true,
        emailVerified: true,
      },
    );

    expect(result.allowed).toBe(true);
  });

  it("rejects an OAuth signup with no invitation for that email", async () => {
    await seedInvitation(`invited-${randomUUID()}@example.com`);

    const result = await checkRegistrationAllowed(
      app.db,
      `stranger-${randomUUID()}@example.com`,
      undefined,
      { allowInvitationByEmail: true, emailVerified: true },
    );

    expect(result.allowed).toBe(false);
  });

  it.each([
    ["expired", { expiresAt: new Date(Date.now() - 86_400_000) }],
    ["already accepted", { status: "accepted" }],
    ["canceled", { status: "canceled" }],
  ])(
    "rejects an OAuth signup when the invitation is %s",
    async (_label, overrides) => {
      const email = `invited-${randomUUID()}@example.com`;
      await seedInvitation(email, overrides);

      const result = await checkRegistrationAllowed(app.db, email, undefined, {
        allowInvitationByEmail: true,
        emailVerified: true,
      });

      expect(result.allowed).toBe(false);
    },
  );

  it("still requires the invitation link on the password signup path", async () => {
    const email = `invited-${randomUUID()}@example.com`;
    await seedInvitation(email);

    const result = await checkRegistrationAllowed(app.db, email);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("valid invitation link");
  });

  it("keeps rejecting an unknown invitation id", async () => {
    const email = `invited-${randomUUID()}@example.com`;
    await seedInvitation(email);

    const result = await checkRegistrationAllowed(
      app.db,
      email,
      "does-not-exist",
      {
        allowInvitationByEmail: true,
        emailVerified: true,
      },
    );

    expect(result.allowed).toBe(false);
  });

  it("allows any signup once registration is open again", async () => {
    vi.stubEnv("DISABLE_REGISTRATION", "false");

    const result = await checkRegistrationAllowed(
      app.db,
      `anyone-${randomUUID()}@example.com`,
    );

    expect(result.allowed).toBe(true);
  });
});
