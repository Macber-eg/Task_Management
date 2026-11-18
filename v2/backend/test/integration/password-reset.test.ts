import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { VerificationEntity } from "../../src/database/entities/verification.entity";
import { BackgroundEmailDeliveries } from "../../src/email/background-email-deliveries";
import { EmailService } from "../../src/email/email.service";
import type { PasswordResetEmailProps } from "../../src/email/templates/password-reset";
import { openBrowser } from "../support/fixtures/email-browser";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const origin = "http://localhost:5173";
const address = "reset@example.com";
const password = "old-password-123";
const newPassword = "new-password-456";
const redirectTo = `${origin}/auth/reset-password`;
const firefox =
  "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";

describe("password reset", () => {
  let app: TestApp;
  let sendReset: MockInstance<EmailService["sendPasswordResetEmail"]>;

  const client = () =>
    openBrowser(app, { origin, "user-agent": firefox });
  const post = (path: string, body: unknown) =>
    client().post(`/api/auth${path}`, body);
  const drain = () => app.get(BackgroundEmailDeliveries).drain();

  async function requestReset() {
    const response = await post("/request-password-reset", {
      email: address,
      redirectTo,
    });
    expect(response.status).toBe(200);
    await drain();
    const [to, subject, props] = sendReset.mock.lastCall ?? [];
    expect(to).toBe(address);
    expect(props).toEqual(
      expect.objectContaining({
        locale: "de-DE",
        userName: "Reset user",
        device: { browser: "Firefox", os: "Linux" },
        requestedAt: expect.any(Date),
      }),
    );
    const link = new URL((props as PasswordResetEmailProps).resetLink);
    expect(link.origin).toBe(
      new URL(process.env.KANEO_API_URL || "http://localhost:1337").origin,
    );
    expect(link.searchParams.get("callbackURL")).toBe(redirectTo);
    expect(subject).toBe("Kaneo-Passwort zurücksetzen");
    // Delivered through the (captured) transport, rendered in German.
    expect(app.emails.last()?.html).toContain(link.pathname);
    return { link, token: link.pathname.split("/").at(-1) ?? "" };
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
    vi.stubEnv("DISABLE_EMAIL_OTP_SIGN_IN", "true");
    sendReset = vi.spyOn(app.get(EmailService), "sendPasswordResetEmail");
    const signUp = await post("/sign-up/email", {
      name: "Reset user",
      email: address,
      password,
      locale: "de-DE",
    });
    expect(signUp.status).toBe(200);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emails a one-hour link, changes the password, revokes sessions and rejects reuse", async () => {
    // With email codes switched off, their routes do not exist.
    expect(
      (
        await post("/email-otp/send-verification-otp", {
          email: address,
          type: "sign-in",
        })
      ).status,
    ).toBe(404);

    const { link, token } = await requestReset();
    const [verification] = await app.db.find(VerificationEntity);
    expect(verification?.identifier).toBe(`reset-password:${token}`);
    const lifetime = (verification?.expiresAt.getTime() ?? 0) - Date.now();
    expect(lifetime).toBeGreaterThan(3_500_000);
    expect(lifetime).toBeLessThanOrEqual(3_600_000);

    const callback = await client().get(`${link.pathname}${link.search}`);
    expect(callback.status).toBe(302);
    const destination = new URL(callback.headers.get("location") ?? "");
    expect(destination.origin + destination.pathname).toBe(redirectTo);
    expect(destination.searchParams.get("token")).toBe(token);

    expect(await app.db.count(SessionEntity)).not.toBe(0);
    const reset = await post("/reset-password", { token, newPassword });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ status: true });
    expect(await app.db.count(SessionEntity)).toBe(0);

    expect(
      (await post("/sign-in/email", { email: address, password })).status,
    ).toBe(401);
    expect(
      (await post("/sign-in/email", { email: address, password: newPassword }))
        .status,
    ).toBe(200);
    const reuse = await post("/reset-password", { token, newPassword: password });
    expect(reuse.status).toBe(400);
    expect((await readErrorBody(reuse)).code).toBe("INVALID_TOKEN");
  });

  it("immediately rejects the old cookies on session and protected API requests", async () => {
    const tab = client();
    expect(
      (
        await tab.post("/api/auth/sign-in/email", { email: address, password })
      ).status,
    ).toBe(200);
    expect((await tab.get("/api/user/me")).status).toBe(200);

    const { token } = await requestReset();
    expect((await post("/reset-password", { token, newPassword })).status).toBe(
      200,
    );
    expect(await app.db.count(SessionEntity)).toBe(0);
    expect((await tab.get("/api/user/me")).status).toBe(401);
    const session = await tab.get("/api/auth/get-session");
    expect(await session.json()).toBeNull();
  });

  it("gives the same confirmation for existing and unknown accounts without sending unknown-account mail", async () => {
    const known = await post("/request-password-reset", {
      email: address,
      redirectTo,
    });
    await drain();
    expect(sendReset).toHaveBeenCalledTimes(1);
    const unknown = await post("/request-password-reset", {
      email: "unknown@example.com",
      redirectTo,
    });
    await drain();
    expect(unknown.status).toBe(known.status);
    const body = await known.json();
    expect(await unknown.json()).toEqual(body);
    expect(body).toEqual({
      status: true,
      message:
        "If this email exists in our system, check your email for the reset link",
    });
    expect(sendReset).toHaveBeenCalledTimes(1);
  });

  it("rejects expired and invalid tokens without changing the password", async () => {
    const { link, token } = await requestReset();
    await app.db.update(
      VerificationEntity,
      { identifier: `reset-password:${token}` },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const callback = await client().get(`${link.pathname}${link.search}`);
    expect(callback.status).toBe(302);
    expect(
      new URL(callback.headers.get("location") ?? "").searchParams.get("error"),
    ).toBe("INVALID_TOKEN");
    for (const invalid of [token, "invalid-token"]) {
      expect(
        (await post("/reset-password", { token: invalid, newPassword })).status,
      ).toBe(400);
    }
    expect(
      (await post("/sign-in/email", { email: address, password })).status,
    ).toBe(200);
  });

  it("validates passwords without consuming the reset token", async () => {
    const { token } = await requestReset();
    for (const [invalid, code] of [
      ["short", "PASSWORD_TOO_SHORT"],
      ["x".repeat(129), "PASSWORD_TOO_LONG"],
    ] as const) {
      const response = await post("/reset-password", {
        token,
        newPassword: invalid,
      });
      expect(response.status).toBe(400);
      expect((await readErrorBody(response)).code).toBe(code);
    }
    expect((await post("/reset-password", { token, newPassword })).status).toBe(
      200,
    );
  });

  it("rejects untrusted redirects and requests without SMTP", async () => {
    const untrusted = await post("/request-password-reset", {
      email: address,
      redirectTo: "https://untrusted.example/reset",
    });
    expect(untrusted.status).toBe(403);
    expect(await readErrorBody(untrusted)).toMatchObject({
      code: "INVALID_REDIRECT_URL",
      message: "Invalid redirectURL",
    });

    vi.stubEnv("SMTP_HOST", "");
    const unconfigured = await post("/request-password-reset", {
      email: address,
      redirectTo,
    });
    expect(unconfigured.status).toBe(403);
    expect((await readErrorBody(unconfigured)).code).toBe(
      "EMAIL_DELIVERY_NOT_CONFIGURED",
    );
    await drain();
    expect(sendReset).not.toHaveBeenCalled();
    expect(await app.db.count(VerificationEntity)).toBe(0);
  });

  it.each([
    ["/request-password-reset", "POST", { email: "reset@example.com" }],
    ["/reset-password", "POST", { token: "token", newPassword: "new-password" }],
    [
      "/reset-password/token?callbackURL=http://localhost:5173/auth/reset-password",
      "GET",
      undefined,
    ],
  ] as const)(
    "blocks %s when local login is disabled",
    async (path, method, body) => {
      vi.stubEnv("DISABLE_LOGIN_FORM", "true");
      const response =
        method === "GET"
          ? await client().get(`/api/auth${path}`)
          : await post(path, body);
      expect(response.status).toBe(403);
      expect((await readErrorBody(response)).code).toBe(
        "LOCAL_SIGN_IN_DISABLED",
      );
    },
  );
});
