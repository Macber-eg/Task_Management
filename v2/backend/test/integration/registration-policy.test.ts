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
import { SessionEntity } from "../../src/database/entities/session.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { VerificationEntity } from "../../src/database/entities/verification.entity";
import { BackgroundEmailDeliveries } from "../../src/email/background-email-deliveries";
import { EmailService } from "../../src/email/email.service";
import { createInvitation } from "../support/fixtures/create-invitation";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { openBrowser } from "../support/fixtures/email-browser";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const REGISTRATION_FLAGS = [
  "DISABLE_REGISTRATION",
  "DISABLE_PASSWORD_REGISTRATION",
  "DISABLE_LOGIN_FORM",
  "DISABLE_GUEST_ACCESS",
] as const;

// The previous suite drove these rules through the auth endpoints. Email
// sign-up is covered over HTTP in auth-sign-up-registration.test.ts and
// guest sign-in in auth-anonymous.test.ts; the rules are exercised directly
// here, and the email-code and magic-link cases over HTTP.
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

  const iphoneSafari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  async function post(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    waitForEmail = true,
  ) {
    const response = await openBrowser(app, {
      origin: "http://localhost:5173",
      ...headers,
    }).post(`/api/auth${path}`, body);
    if (waitForEmail) await app.get(BackgroundEmailDeliveries).drain();
    return response;
  }

  // Both methods take (to, subject, props) and resolve to nothing; typed as
  // the code email so tests can read the code.
  function spyOnEmail(method: "sendOtpEmail" | "sendMagicLinkEmail") {
    return vi
      .spyOn(app.get(EmailService), method as "sendOtpEmail")
      .mockResolvedValue(undefined);
  }

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

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

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

  it("prevents new OTP accounts under the local-registration restriction but preserves existing-user OTP login", async () => {
    const member = await createWorkspaceMember(app.db);
    vi.stubEnv("DISABLE_PASSWORD_REGISTRATION", "true");
    const send = spyOnEmail("sendOtpEmail");
    const sendMagicLink = spyOnEmail("sendMagicLinkEmail");
    for (const address of ["new-otp@example.com", member.user.email]) {
      expect(
        (
          await post(
            "/email-otp/send-verification-otp",
            { email: address, type: "sign-in" },
            { "user-agent": iphoneSafari },
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await post(
            "/sign-in/magic-link",
            { email: address },
            { "user-agent": iphoneSafari },
          )
        ).status,
      ).toBe(200);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.lastCall?.[0]).toBe(member.user.email);
    expect(sendMagicLink).toHaveBeenCalledTimes(1);
    expect(sendMagicLink.mock.lastCall?.[0]).toBe(member.user.email);
    const data = send.mock.lastCall?.[2];
    expect(data?.otp).toBeTruthy();
    expect(send.mock.lastCall?.[1]).toBe(
      `${data?.otp} is your Kaneo sign-in code`,
    );
    const requestContext = expect.objectContaining({
      device: { browser: "Safari", os: "iPhone" },
      requestedAt: expect.any(Date),
    });
    expect(send.mock.lastCall?.[2]).toEqual(requestContext);
    expect(sendMagicLink.mock.lastCall?.[2]).toEqual(requestContext);
    const response = await post("/sign-in/email-otp", {
      email: member.user.email,
      otp: data?.otp,
    });
    expect(response.status).toBe(200);
    expect(await app.db.count(UserEntity)).toBe(1);
  });

  it("still emails the first user's OTP and magic link for initial setup when registration is disabled", async () => {
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    const sendOtp = spyOnEmail("sendOtpEmail");
    const sendMagicLink = spyOnEmail("sendMagicLinkEmail");

    expect(
      (
        await post("/email-otp/send-verification-otp", {
          email: "first@example.com",
          type: "sign-in",
        })
      ).status,
    ).toBe(200);
    expect(
      (await post("/sign-in/magic-link", { email: "first@example.com" }))
        .status,
    ).toBe(200);
    expect(sendOtp.mock.calls.map((call) => call[0])).toEqual([
      "first@example.com",
    ]);
    expect(sendMagicLink.mock.calls.map((call) => call[0])).toEqual([
      "first@example.com",
    ]);

    const response = await post("/sign-in/email-otp", {
      email: "first@example.com",
      otp: sendOtp.mock.lastCall?.[2].otp,
    });
    expect(response.status).toBe(200);
    expect(await app.db.find(UserEntity)).toEqual([
      expect.objectContaining({
        email: "first@example.com",
        emailVerified: true,
        role: "admin",
      }),
    ]);
  });

  it("only emails sign-in OTPs and magic links to existing or invited addresses when registration is disabled", async () => {
    const member = await createWorkspaceMember(app.db);
    const invite = await invitation("invitee@example.com");
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    const sendOtp = spyOnEmail("sendOtpEmail");
    const sendMagicLink = spyOnEmail("sendMagicLinkEmail");

    for (const address of [
      member.user.email,
      invite.email,
      "stranger@example.com",
    ]) {
      expect(
        (
          await post("/email-otp/send-verification-otp", {
            email: address,
            type: "sign-in",
          })
        ).status,
      ).toBe(200);
      expect(
        (await post("/sign-in/magic-link", { email: address })).status,
      ).toBe(200);
    }

    const expected = [invite.email, member.user.email].sort();
    const recipients = (mock: { mock: { calls: unknown[][] } }) =>
      mock.mock.calls.map((call) => call[0]).sort();
    expect(recipients(sendOtp)).toEqual(expected);
    expect(recipients(sendMagicLink)).toEqual(expected);
  });

  it("lets an invited address register with a verified code but not a stranger", async () => {
    await createWorkspaceMember(app.db);
    const invite = await invitation("invitee@example.com");
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    const sendOtp = spyOnEmail("sendOtpEmail");

    await post("/email-otp/send-verification-otp", {
      email: invite.email,
      type: "sign-in",
    });
    const accepted = await post("/sign-in/email-otp", {
      email: invite.email,
      otp: sendOtp.mock.lastCall?.[2].otp,
    });
    expect(accepted.status).toBe(200);

    // A code is still issued for a stranger, but redeeming it creates nothing.
    await post("/email-otp/send-verification-otp", {
      email: "stranger@example.com",
      type: "sign-in",
    });
    const [code] = await app.db.findBy(VerificationEntity, {
      identifier: "sign-in-otp-stranger@example.com",
    });
    const refused = await post("/sign-in/email-otp", {
      email: "stranger@example.com",
      otp: code?.value.split(":")[0],
    });
    expect(refused.status).toBe(403);
    expect((await readErrorBody(refused)).code).toBe("REGISTRATION_NOT_ALLOWED");
    expect(
      await app.db.countBy(UserEntity, { email: "stranger@example.com" }),
    ).toBe(0);
  });

  it.each(["/email-otp/send-verification-otp", "/sign-in/magic-link"] as const)(
    "returns from %s without waiting for SMTP",
    async (path) => {
      const member = await createWorkspaceMember(app.db);
      const invite = await invitation("timing-invitee@example.com");
      vi.stubEnv("DISABLE_REGISTRATION", "true");
      let releaseDelivery!: () => void;
      const blockedDelivery = new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
      const send = vi
        .spyOn(
          app.get(EmailService),
          path === "/sign-in/magic-link" ? "sendMagicLinkEmail" : "sendOtpEmail",
        )
        .mockReturnValue(blockedDelivery);

      try {
        const responses = await Promise.all(
          [member.user.email, invite.email, "unknown@example.com"].map(
            async (address) => {
              const response = await post(
                path,
                { email: address, type: "sign-in" },
                {},
                false,
              );
              return { status: response.status, body: await response.json() };
            },
          ),
        );
        // Every response arrived while SMTP was still blocked.
        expect(responses[0]?.status).toBe(200);
        expect(responses).toEqual([responses[0], responses[0], responses[0]]);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        expect(send.mock.calls.map(([address]) => address).sort()).toEqual(
          [member.user.email, invite.email].sort(),
        );
      } finally {
        releaseDelivery();
        await app.get(BackgroundEmailDeliveries).drain();
      }
    },
  );

  it("stores a five-minute OTP expiry and rejects an expired code", async () => {
    const member = await createWorkspaceMember(app.db);
    const send = spyOnEmail("sendOtpEmail");
    const before = Date.now();
    expect(
      (
        await post("/email-otp/send-verification-otp", {
          email: member.user.email,
          type: "sign-in",
        })
      ).status,
    ).toBe(200);
    const rows = await app.db.find(VerificationEntity);
    expect(rows).toHaveLength(1);
    const expiresAt = rows[0]?.expiresAt.getTime() ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    await app.db.update(
      VerificationEntity,
      { id: rows[0]?.id },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const response = await post("/sign-in/email-otp", {
      email: member.user.email,
      otp: send.mock.lastCall?.[2].otp,
    });
    expect(response.status).toBe(400);
    expect((await readErrorBody(response)).code).toBe("OTP_EXPIRED");
    expect(await app.db.count(SessionEntity)).toBe(0);
  });
});
