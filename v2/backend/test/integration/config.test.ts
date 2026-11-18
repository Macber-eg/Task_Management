import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: config", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
    app.auth.signOut();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["true", "false", undefined])(
    "returns cloud mode for KANEO_CLOUD=%s",
    async (value) => {
      vi.stubEnv("KANEO_CLOUD", value);
      const response = await app.request("/api/config");
      expect(response.status).toBe(200);
      expect(await response.json()).toHaveProperty("isCloud", value === "true");
    },
  );

  it("returns the public config shape", async () => {
    for (const flag of [
      "DISABLE_REGISTRATION",
      "DISABLE_PASSWORD_REGISTRATION",
      "DISABLE_EMAIL_OTP_SIGN_IN",
      "DISABLE_LOGIN_FORM",
      "DISABLE_GUEST_ACCESS",
      "CUSTOM_OAUTH_AUTO_LOGIN",
      "DEMO_MODE",
    ]) {
      vi.stubEnv(flag, undefined);
    }

    const response = await app.request("/api/config");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload).toMatchObject({
      disableRegistration: false,
      disablePasswordRegistration: false,
      disableEmailOtpSignIn: false,
      disableLoginForm: false,
      customOAuthAutoLogin: false,
      isDemoMode: false,
      hasGuestAccess: true,
    });
    expect(payload).toSatisfy((value: Record<string, unknown>) =>
      [
        "hasSmtp",
        "hasGithubSignIn",
        "hasGoogleSignIn",
        "hasDiscordSignIn",
        "hasCustomOAuth",
      ].every((key) => typeof value[key] === "boolean"),
    );
  });

  it("reports the web app's captcha, error reporting and analytics settings", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", undefined);
    vi.stubEnv("KANEO_TURNSTILE_SITE_KEY", "legacy-site-key");
    vi.stubEnv("SENTRY_WEB_DSN", "https://key@sentry.example.com/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("PLAUSIBLE_DOMAIN", "tasks.example.com");
    vi.stubEnv("PLAUSIBLE_SCRIPT_URL", "https://plausible.example.com/s.js");

    const configured = await app.request("/api/config");

    expect(await configured.json()).toMatchObject({
      turnstileSiteKey: "legacy-site-key",
      sentryDsn: "https://key@sentry.example.com/1",
      sentryEnvironment: "staging",
      analytics: {
        plausibleDomain: "tasks.example.com",
        scriptUrl: "https://plausible.example.com/s.js",
      },
    });

    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("SENTRY_WEB_DSN", undefined);
    vi.stubEnv("SENTRY_ENVIRONMENT", undefined);
    vi.stubEnv("PLAUSIBLE_SCRIPT_URL", undefined);

    const partial = await app.request("/api/config");

    expect(await partial.json()).toMatchObject({
      turnstileSiteKey: "site-key",
      sentryDsn: null,
      sentryEnvironment: null,
      analytics: null,
    });
  });
});
