import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "./get-settings";

const WEB_APP_KEYS = [
  "TURNSTILE_SITE_KEY",
  "KANEO_TURNSTILE_SITE_KEY",
  "SENTRY_WEB_DSN",
  "SENTRY_ENVIRONMENT",
  "PLAUSIBLE_DOMAIN",
  "PLAUSIBLE_SCRIPT_URL",
];

describe("getSettings", () => {
  beforeEach(() => {
    for (const key of WEB_APP_KEYS) vi.stubEnv(key, undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reports null for every unconfigured web app setting", () => {
    expect(getSettings()).toMatchObject({
      turnstileSiteKey: null,
      sentryDsn: null,
      sentryEnvironment: null,
      analytics: null,
    });
  });

  it("prefers TURNSTILE_SITE_KEY over the legacy name", () => {
    vi.stubEnv("KANEO_TURNSTILE_SITE_KEY", "legacy");
    expect(getSettings().turnstileSiteKey).toBe("legacy");

    vi.stubEnv("TURNSTILE_SITE_KEY", "current");
    expect(getSettings().turnstileSiteKey).toBe("current");
  });

  it("reads the environment on every call", () => {
    vi.stubEnv("SENTRY_WEB_DSN", "https://key@sentry.example.com/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "production");
    expect(getSettings()).toMatchObject({
      sentryDsn: "https://key@sentry.example.com/1",
      sentryEnvironment: "production",
    });

    vi.stubEnv("SENTRY_WEB_DSN", "");
    expect(getSettings().sentryDsn).toBeNull();
  });

  it.each([
    ["PLAUSIBLE_DOMAIN", "tasks.example.com"],
    ["PLAUSIBLE_SCRIPT_URL", "https://plausible.example.com/script.js"],
  ])("keeps analytics off when only %s is set", (key, value) => {
    vi.stubEnv(key, value);
    expect(getSettings().analytics).toBeNull();
  });

  it("reports analytics when the domain and the script URL are both set", () => {
    vi.stubEnv("PLAUSIBLE_DOMAIN", "tasks.example.com");
    vi.stubEnv("PLAUSIBLE_SCRIPT_URL", "https://plausible.example.com/s.js");

    expect(getSettings().analytics).toEqual({
      plausibleDomain: "tasks.example.com",
      scriptUrl: "https://plausible.example.com/s.js",
    });
  });

  it("offers guest access only while no sign-up restriction is on", () => {
    const flags = [
      "DISABLE_GUEST_ACCESS",
      "DISABLE_REGISTRATION",
      "DISABLE_PASSWORD_REGISTRATION",
      "DISABLE_LOGIN_FORM",
    ];
    for (const flag of flags) vi.stubEnv(flag, undefined);
    expect(getSettings().hasGuestAccess).toBe(true);

    for (const flag of flags) {
      vi.stubEnv(flag, "true");
      expect(getSettings().hasGuestAccess).toBe(false);
      vi.stubEnv(flag, undefined);
    }
  });
});
