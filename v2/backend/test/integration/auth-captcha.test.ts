import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { UserEntity } from "../../src/database/entities/user.entity";
import { VerificationEntity } from "../../src/database/entities/verification.entity";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { openBrowser } from "../support/fixtures/email-browser";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const endpoints = [
  [
    "/sign-up/email",
    {
      name: "User",
      email: "captcha@example.com",
      password: "long-test-password",
    },
  ],
  [
    "/sign-in/social",
    { provider: "github", callbackURL: "http://localhost:5173/dashboard" },
  ],
  [
    "/sign-in/oauth2",
    { providerId: "custom", callbackURL: "http://localhost:5173/dashboard" },
  ],
  ["/sign-in/anonymous", {}],
  ["/request-password-reset", { email: "captcha@example.com" }],
  [
    "/sign-in/magic-link",
    {
      email: "captcha@example.com",
      callbackURL: "http://localhost:5173/dashboard",
    },
  ],
  [
    "/email-otp/send-verification-otp",
    { email: "captcha@example.com", type: "sign-in" },
  ],
] as const;

describe("server-side auth CAPTCHA enforcement", () => {
  let app: TestApp;
  const realFetch = globalThis.fetch;
  let siteverify: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

  // The test client speaks HTTP through fetch too, so only Cloudflare's
  // endpoint is replaced.
  function stubSiteverify(
    implementation?: (url: string, init?: RequestInit) => Promise<Response>,
  ) {
    siteverify = vi.fn(implementation);
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith(SITEVERIFY)
        ? siteverify(String(input), init)
        : realFetch(input, init),
    );
  }

  function post(path: string, body: unknown, token?: string) {
    return openBrowser(app, {
      origin: "http://localhost:5173",
      ...(token ? { "x-turnstile-token": token } : {}),
    }).post(`/api/auth${path}`, body);
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    vi.stubEnv("SMTP_FROM", "Kaneo <kaneo@example.test>");
    vi.stubEnv("KANEO_CLIENT_URL", "http://localhost:5173");
    await createWorkspaceMember(app.db);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-only-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(endpoints)("rejects token-free calls to %s", async (path, body) => {
    stubSiteverify();
    const response = await post(path, body);
    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toMatchObject({
      code: "CAPTCHA_FAILED",
      message: "Captcha verification failed.",
    });
    expect(siteverify).not.toHaveBeenCalled();
    expect(await app.db.count(UserEntity)).toBe(1);
    expect(await app.db.count(VerificationEntity)).toBe(0);
  });

  it.each(endpoints)(
    "verifies before any account/mail/provider action at %s",
    async (path, body) => {
      stubSiteverify(async () => new Response(JSON.stringify({ success: false })));
      expect((await post(path, body, "invalid-token")).status).toBe(403);
      expect(siteverify).toHaveBeenCalledTimes(1);
      expect(siteverify.mock.calls[0]?.[0]).toBe(SITEVERIFY);
      expect(await app.db.count(UserEntity)).toBe(1);
      expect(await app.db.count(VerificationEntity)).toBe(0);
    },
  );

  it("permits one verified guest request and rejects a replay response", async () => {
    let calls = 0;
    stubSiteverify(async () => {
      calls += 1;
      return new Response(
        JSON.stringify(
          calls === 1
            ? { success: true, hostname: "localhost", action: "auth" }
            : { success: false, "error-codes": ["timeout-or-duplicate"] },
        ),
      );
    });
    expect((await post("/sign-in/anonymous", {}, "single-use-token")).status).toBe(
      200,
    );
    expect((await post("/sign-in/anonymous", {}, "single-use-token")).status).toBe(
      403,
    );
    expect(await app.db.count(UserEntity)).toBe(2);
  });

  it("accepts the token in the request body too", async () => {
    stubSiteverify(
      async () =>
        new Response(
          JSON.stringify({ success: true, hostname: "localhost", action: "auth" }),
        ),
    );
    expect(
      (await post("/sign-in/anonymous", { turnstileToken: "body-token" })).status,
    ).toBe(200);
    const form = siteverify.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(form.get("response")).toBe("body-token");
  });

  it("does not exempt password bootstrap from configured CAPTCHA", async () => {
    await resetTestDatabase(app.dataSource);
    stubSiteverify();
    expect((await post("/sign-up/email", endpoints[0][1])).status).toBe(403);
    expect(await app.db.count(UserEntity)).toBe(0);
  });

  it("does not redeem a second token at an OAuth callback", async () => {
    stubSiteverify();
    const response = await openBrowser(app).get(
      "/api/auth/callback/github?code=invalid&state=invalid",
    );
    expect(response.status).not.toBe(200);
    expect(siteverify).not.toHaveBeenCalled();
    expect(await app.db.count(UserEntity)).toBe(1);
  });
});
