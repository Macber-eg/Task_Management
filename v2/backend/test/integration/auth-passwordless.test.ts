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
import { AccountEntity } from "../../src/database/entities/account.entity";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { VerificationEntity } from "../../src/database/entities/verification.entity";
import { BackgroundEmailDeliveries } from "../../src/email/background-email-deliveries";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { linkIn, openBrowser } from "../support/fixtures/email-browser";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const origin = "http://localhost:5173";
const LAST_LOGIN = "better-auth.last_used_login_method";

describe("passwordless sign-in", () => {
  let app: TestApp;

  const browser = (headers: Record<string, string> = {}) =>
    openBrowser(app, { origin, ...headers });
  const drain = () => app.get(BackgroundEmailDeliveries).drain();

  async function sendCode(email: string, tab = browser()) {
    const response = await tab.post("/api/auth/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    await drain();
    const subject = app.emails.to(email.toLowerCase()).at(-1)?.subject ?? "";
    return subject.split(" ")[0] ?? "";
  }

  async function sendLink(body: Record<string, unknown>, tab = browser()) {
    const response = await tab.post("/api/auth/sign-in/magic-link", body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    await drain();
    const html = app.emails.last()?.html ?? "";
    return linkIn(html, "/magic-link/verify");
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    app.emails.clear();
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    vi.stubEnv("SMTP_FROM", "Kaneo <kaneo@example.test>");
    for (const flag of [
      "DISABLE_REGISTRATION",
      "DISABLE_PASSWORD_REGISTRATION",
      "DISABLE_LOGIN_FORM",
      "DISABLE_EMAIL_OTP_SIGN_IN",
      "TURNSTILE_SECRET_KEY",
    ]) {
      vi.stubEnv(flag, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("email codes", () => {
    it("signs an existing user in with an emailed code, once", async () => {
      const { user } = await createWorkspaceMember(app.db);
      const tab = browser();
      const otp = await sendCode(user.email, tab);
      expect(otp).toMatch(/^\d{6}$/);
      expect(app.emails.last()?.html).toContain(otp);

      const response = await tab.post("/api/auth/sign-in/email-otp", {
        email: user.email.toUpperCase(),
        otp,
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        token: string;
        user: { id: string; email: string };
      };
      expect(body.user).toMatchObject({ id: user.id, email: user.email });
      expect(body.token).toMatch(/^eyJ/);
      expect(tab.jar.get(LAST_LOGIN)).toBeUndefined();
      expect((await tab.get("/api/user/me")).status).toBe(200);
      expect(await app.db.count(VerificationEntity)).toBe(0);

      const replay = await browser().post("/api/auth/sign-in/email-otp", {
        email: user.email,
        otp,
      });
      expect(replay.status).toBe(400);
      expect((await readErrorBody(replay)).code).toBe("INVALID_OTP");
    });

    it("allows two wrong guesses and then locks the code", async () => {
      const { user } = await createWorkspaceMember(app.db);
      const otp = await sendCode(user.email);
      const wrong = otp === "000000" ? "111111" : "000000";
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await browser().post("/api/auth/sign-in/email-otp", {
          email: user.email,
          otp: wrong,
        });
        expect(response.status).toBe(400);
        expect((await readErrorBody(response)).code).toBe("INVALID_OTP");
      }
      const locked = await browser().post("/api/auth/sign-in/email-otp", {
        email: user.email,
        otp,
      });
      expect(locked.status).toBe(403);
      expect(await readErrorBody(locked)).toMatchObject({
        code: "TOO_MANY_ATTEMPTS",
        message: "Too many attempts",
      });
      expect(await app.db.count(SessionEntity)).toBe(0);
    });

    it("creates a verified account for a new address with the requested locale", async () => {
      await createWorkspaceMember(app.db);
      const otp = await sendCode("New.Person@example.com");
      const response = await browser().post("/api/auth/sign-in/email-otp", {
        email: "new.person@example.com",
        otp,
        name: "New Person",
        locale: "de-DE",
      });
      expect(response.status).toBe(200);
      expect(
        await app.db.findOneByOrFail(UserEntity, {
          email: "new.person@example.com",
        }),
      ).toMatchObject({
        name: "New Person",
        emailVerified: true,
        locale: "de-DE",
        role: "user",
        isAnonymous: false,
      });
    });

    it("strips a password and sessions that predate proof of the mailbox", async () => {
      const user = await createUser(app.db, { emailVerified: false });
      await insertRow(app.db, AccountEntity, {
        id: "credential-of-unverified",
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: "not-a-real-hash",
      });
      await insertRow(app.db, SessionEntity, {
        id: "planted-session",
        token: "planted-token",
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const otp = await sendCode(user.email);
      const response = await browser().post("/api/auth/sign-in/email-otp", {
        email: user.email,
        otp,
      });
      expect(response.status).toBe(200);
      expect(
        await app.db.countBy(AccountEntity, { userId: user.id }),
      ).toBe(0);
      expect(await app.db.findBy(SessionEntity, { userId: user.id })).toEqual([
        expect.not.objectContaining({ id: "planted-session" }),
      ]);
      expect(
        (await app.db.findOneByOrFail(UserEntity, { id: user.id }))
          .emailVerified,
      ).toBe(true);
    });

    it("refuses a banned user and lifts a ban that ran out", async () => {
      const banned = await createUser(app.db, { banned: true });
      const otp = await sendCode(banned.email);
      const refused = await browser().post("/api/auth/sign-in/email-otp", {
        email: banned.email,
        otp,
      });
      expect(refused.status).toBe(403);
      expect((await readErrorBody(refused)).code).toBe("BANNED_USER");

      const expired = await createUser(app.db, {
        banned: true,
        banReason: "spam",
        banExpires: new Date(Date.now() - 60_000),
      });
      const code = await sendCode(expired.email);
      const accepted = await browser().post("/api/auth/sign-in/email-otp", {
        email: expired.email,
        otp: code,
      });
      expect(accepted.status).toBe(200);
      expect(
        await app.db.findOneByOrFail(UserEntity, { id: expired.id }),
      ).toMatchObject({ banned: false, banReason: null, banExpires: null });
    });

    it("validates the address and the code type", async () => {
      const invalid = await browser().post(
        "/api/auth/email-otp/send-verification-otp",
        { email: "not-an-email", type: "sign-in" },
      );
      expect(invalid.status).toBe(400);
      expect((await readErrorBody(invalid)).code).toBe("INVALID_EMAIL");

      const changeEmail = await browser().post(
        "/api/auth/email-otp/send-verification-otp",
        { email: "someone@example.com", type: "change-email" },
      );
      expect(changeEmail.status).toBe(400);
      expect((await readErrorBody(changeEmail)).message).toBe(
        "Invalid OTP type",
      );
    });

    it("keeps no code for an unknown address when it could not register", async () => {
      await createWorkspaceMember(app.db);
      vi.stubEnv("DISABLE_PASSWORD_REGISTRATION", "true");
      await sendCode("nobody@example.com");
      expect(await app.db.count(VerificationEntity)).toBe(0);
      expect(app.emails.sent).toHaveLength(0);
    });

    it("refuses browser requests without a trusted origin", async () => {
      // fetch always sends Sec-Fetch-Mode, which makes the Origin mandatory.
      const anonymous = await openBrowser(app, {
        "sec-fetch-site": "cross-site",
      }).post("/api/auth/email-otp/send-verification-otp", {
        email: "someone@example.com",
        type: "sign-in",
      });
      expect(anonymous.status).toBe(403);
      expect((await readErrorBody(anonymous)).code).toBe(
        "MISSING_OR_NULL_ORIGIN",
      );

      const foreign = await openBrowser(app, {
        origin: "https://evil.example",
      }).post("/api/auth/sign-in/magic-link", { email: "someone@example.com" });
      expect(foreign.status).toBe(403);
      expect((await readErrorBody(foreign)).code).toBe("INVALID_ORIGIN");
    });

    it.each([
      ["/email-otp/send-verification-otp", { email: "a@example.com", type: "sign-in" }],
      ["/sign-in/email-otp", { email: "a@example.com", otp: "123456" }],
      ["/sign-in/magic-link", { email: "a@example.com" }],
    ])("blocks %s when local login is disabled", async (path, body) => {
      vi.stubEnv("DISABLE_LOGIN_FORM", "true");
      const response = await browser().post(`/api/auth${path}`, body);
      expect(response.status).toBe(403);
      expect((await readErrorBody(response)).code).toBe(
        "LOCAL_SIGN_IN_DISABLED",
      );
    });

    it("does not route email codes when they are switched off", async () => {
      vi.stubEnv("DISABLE_EMAIL_OTP_SIGN_IN", "true");
      for (const path of [
        "/email-otp/send-verification-otp",
        "/sign-in/email-otp",
      ]) {
        expect(
          (await browser().post(`/api/auth${path}`, {})).status,
        ).toBe(404);
      }
    });
  });

  describe("magic links", () => {
    it("signs in through the emailed link and redirects to the callback", async () => {
      const { user } = await createWorkspaceMember(app.db);
      const link = await sendLink({
        email: user.email,
        callbackURL: `${origin}/dashboard`,
        newUserCallbackURL: `${origin}/onboarding`,
      });
      expect(link.origin).toBe(
        new URL(process.env.KANEO_API_URL || "http://localhost:1337").origin,
      );
      expect(app.emails.last()?.subject).toBe("Login for Kaneo");

      const tab = browser();
      const verify = await tab.get(`${link.pathname}${link.search}`);
      expect(verify.status).toBe(302);
      expect(verify.headers.get("location")).toBe(`${origin}/dashboard`);
      expect(tab.jar.get(LAST_LOGIN)).toBe("magic-link");
      expect((await tab.get("/api/user/me")).status).toBe(200);

      const replay = await browser().get(`${link.pathname}${link.search}`);
      expect(replay.status).toBe(302);
      expect(replay.headers.get("location")).toBe(
        `${origin}/dashboard?error=INVALID_TOKEN`,
      );
    });

    it("sends a new account to the new-user page and answers JSON without a callback", async () => {
      await createWorkspaceMember(app.db);
      const link = await sendLink({
        email: "Newcomer@example.com",
        name: "Newcomer",
        callbackURL: "/dashboard",
        newUserCallbackURL: "/welcome",
      });
      const verify = await browser().get(`${link.pathname}${link.search}`);
      expect(verify.status).toBe(302);
      expect(new URL(verify.headers.get("location") ?? "").pathname).toBe(
        "/welcome",
      );
      expect(
        await app.db.findOneByOrFail(UserEntity, {
          email: "newcomer@example.com",
        }),
      ).toMatchObject({ name: "Newcomer", emailVerified: true });

      const second = await sendLink({ email: "newcomer@example.com" });
      second.searchParams.delete("callbackURL");
      const json = await browser().get(`${second.pathname}${second.search}`);
      expect(json.status).toBe(200);
      expect(await json.json()).toMatchObject({
        token: expect.stringMatching(/^eyJ/),
        user: { email: "newcomer@example.com" },
        session: { userId: expect.any(String) },
      });
    });

    it("redirects with an error when new accounts are not allowed", async () => {
      await createWorkspaceMember(app.db);
      vi.stubEnv("DISABLE_PASSWORD_REGISTRATION", "true");
      const response = await browser().post("/api/auth/sign-in/magic-link", {
        email: "stranger@example.com",
        callbackURL: "/dashboard",
        errorCallbackURL: "/auth/sign-in",
      });
      expect(response.status).toBe(200);
      await drain();
      expect(app.emails.sent).toHaveLength(0);
      const [row] = await app.db.find(VerificationEntity);
      const verify = await browser().get(
        `/api/auth/magic-link/verify?token=${row?.identifier}&callbackURL=%2Fdashboard&errorCallbackURL=%2Fauth%2Fsign-in`,
      );
      expect(verify.status).toBe(302);
      const location = new URL(verify.headers.get("location") ?? "");
      expect(location.pathname).toBe("/auth/sign-in");
      expect(location.searchParams.get("error")).toBe(
        "new_user_signup_disabled",
      );
      expect(await app.db.countBy(UserEntity, { email: "stranger@example.com" })).toBe(0);
    });

    it("refuses redirect targets outside the web app and the API", async () => {
      const response = await browser().post("/api/auth/sign-in/magic-link", {
        email: "someone@example.com",
        callbackURL: "https://evil.example/steal",
      });
      expect(response.status).toBe(403);
      expect(await readErrorBody(response)).toMatchObject({
        code: "INVALID_CALLBACK_URL",
        message: "Invalid callbackURL",
      });
      const verify = await browser().get(
        "/api/auth/magic-link/verify?token=x&callbackURL=https%3A%2F%2Fevil.example",
      );
      expect(verify.status).toBe(403);
      expect(await app.db.count(VerificationEntity)).toBe(0);
    });
  });
});
