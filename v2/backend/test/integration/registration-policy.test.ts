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
import { canSendSignInEmail } from "../../src/auth/registration/can-send-sign-in-email";
import { InstanceBootstrapService } from "../../src/auth/instance/instance-bootstrap.service";
import { assertUserRegistrationAllowed } from "../../src/auth/registration/registration-policy";
import { UserEntity } from "../../src/database/entities/user.entity";
import { createInvitation } from "../support/fixtures/create-invitation";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const REGISTRATION_FLAGS = [
  "DISABLE_REGISTRATION",
  "DISABLE_PASSWORD_REGISTRATION",
  "DISABLE_LOGIN_FORM",
  "DISABLE_GUEST_ACCESS",
] as const;

// The previous suite drove these rules through the auth endpoints. Email
// sign-up is covered over HTTP in auth-sign-up-registration.test.ts; the
// rules are exercised directly here, and the OTP and magic-link cases wait
// for those endpoints.
describe("auth registration and bootstrap boundaries", () => {
  let app: TestApp;

  async function invitation(email: string) {
    const inviter = await createWorkspaceMember(app.db, { role: "owner" });
    return createInvitation(app.db, {
      email,
      workspaceId: inviter.workspace.id,
      inviterId: inviter.user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  const guest = { email: "guest@example.com", isAnonymous: true };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    for (const flag of REGISTRATION_FLAGS) vi.stubEnv(flag, undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects anonymous bootstrap and ignores historical anonymous rows", async () => {
    await expect(
      assertUserRegistrationAllowed(app.db, guest),
    ).rejects.toMatchObject({ status: 403, code: "GUEST_ACCESS_DISABLED" });

    await createUser(app.db, { id: "old-guest", isAnonymous: true });
    await expect(
      assertUserRegistrationAllowed(app.db, guest),
    ).rejects.toMatchObject({ status: 403, code: "GUEST_ACCESS_DISABLED" });

    // The first real account sets the instance up even with registration off.
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    await expect(
      assertUserRegistrationAllowed(
        app.db,
        { email: "first@example.com" },
        { path: "/sign-up/email" },
      ),
    ).resolves.toBeUndefined();
  });

  it.each(REGISTRATION_FLAGS)(
    "enforces %s on anonymous sign-in",
    async (flag) => {
      await createWorkspaceMember(app.db);
      vi.stubEnv(flag, "true");

      await expect(
        assertUserRegistrationAllowed(app.db, guest),
      ).rejects.toMatchObject({
        status: 403,
        code: "GUEST_ACCESS_DISABLED",
        message: "Guest access is unavailable on this instance.",
      });
    },
  );

  it("allows configured guest access on an initialized open instance", async () => {
    await createWorkspaceMember(app.db);

    await expect(
      assertUserRegistrationAllowed(app.db, guest),
    ).resolves.toBeUndefined();
  });

  it("requires the matching invitation secret for password signup", async () => {
    const invite = await invitation("invitee@example.com");
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    const signup = (email: string, invitationId?: string) =>
      assertUserRegistrationAllowed(
        app.db,
        { email },
        { path: "/sign-up/email", invitationId },
      );
    const refused = { status: 403, code: "REGISTRATION_NOT_ALLOWED" };

    await expect(signup(invite.email)).rejects.toMatchObject(refused);
    await expect(signup(invite.email, "wrong")).rejects.toMatchObject(refused);
    await expect(signup("other@example.com", invite.id)).rejects.toMatchObject(
      refused,
    );
    await expect(signup(invite.email, invite.id)).resolves.toBeUndefined();
  });

  it("only accepts provider or mailbox verified email claims at the user-create boundary", async () => {
    await invitation("invitee@example.com");
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    for (const path of [
      "/callback/github",
      "/oauth2/callback/custom",
      "/sign-in/email-otp",
      "/magic-link/verify",
    ]) {
      await expect(
        assertUserRegistrationAllowed(
          app.db,
          { email: "invitee@example.com", emailVerified: false },
          { path },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        assertUserRegistrationAllowed(
          app.db,
          { email: "invitee@example.com", emailVerified: true },
          { path },
        ),
      ).resolves.toBeUndefined();
    }
    await expect(
      assertUserRegistrationAllowed(
        app.db,
        { email: "invitee@example.com", emailVerified: true },
        { path: "/sign-up/email" },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("prevents new local accounts under the local-registration restriction but not OAuth ones", async () => {
    await createWorkspaceMember(app.db);
    vi.stubEnv("DISABLE_PASSWORD_REGISTRATION", "true");

    for (const path of ["/sign-up/email", "/sign-in/email-otp"]) {
      await expect(
        assertUserRegistrationAllowed(
          app.db,
          { email: "new@example.com", emailVerified: true },
          { path },
        ),
      ).rejects.toMatchObject({
        status: 403,
        code: "LOCAL_REGISTRATION_DISABLED",
      });
    }
    await expect(
      assertUserRegistrationAllowed(
        app.db,
        { email: "new@example.com", emailVerified: true },
        { path: "/callback/github" },
      ),
    ).resolves.toBeUndefined();
  });

  it("only emails sign-in OTPs and magic links to existing or invited addresses", async () => {
    const member = await createWorkspaceMember(app.db);
    await invitation("invitee@example.com");

    expect(await canSendSignInEmail(app.db, member.user.email)).toBe(true);
    expect(await canSendSignInEmail(app.db, "Invitee@Example.com")).toBe(true);
    expect(await canSendSignInEmail(app.db, "stranger@example.com")).toBe(
      false,
    );
  });

  it("elects exactly one admin when multiple first users already exist before the after-hooks", async () => {
    for (const id of ["first", "second"]) {
      await createUser(app.db, {
        id,
        name: id,
        email: `${id}@example.com`,
        createdAt: new Date("2026-01-01"),
      });
    }
    const bootstrap = app.get(InstanceBootstrapService);

    await Promise.all([
      bootstrap.promoteInitialAdministrator("second"),
      bootstrap.promoteInitialAdministrator("first"),
    ]);

    expect(await app.db.findBy(UserEntity, { role: "admin" })).toEqual([
      expect.objectContaining({ id: "first" }),
    ]);
  });

  // Skipped: they need the email OTP and magic-link endpoints, not ported yet.
  it.skip("still emails the first user's OTP and magic link for initial setup when registration is disabled", () => {});

  it.skip.each(["/email-otp/send-verification-otp", "/sign-in/magic-link"])(
    "returns from %s without waiting for SMTP",
    () => {},
  );

  it.skip("stores a five-minute OTP expiry and rejects an expired code", () => {});
});
