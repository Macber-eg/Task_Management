import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBillingEnabled } from "./is-billing-enabled";

describe("isBillingEnabled", () => {
  beforeEach(() => {
    for (const key of [
      "KANEO_CLOUD",
      "CREEM_API_KEY",
      "CREEM_WEBHOOK_SECRET",
    ]) {
      vi.stubEnv(key, undefined);
    }
  });

  afterEach(() => vi.unstubAllEnvs());

  it("is disabled unless cloud + both keys are set", () => {
    expect(isBillingEnabled()).toBe(false);

    vi.stubEnv("KANEO_CLOUD", "true");
    expect(isBillingEnabled()).toBe(false);

    vi.stubEnv("CREEM_API_KEY", "key");
    expect(isBillingEnabled()).toBe(false);

    vi.stubEnv("CREEM_WEBHOOK_SECRET", "secret");
    expect(isBillingEnabled()).toBe(true);
  });

  it("stays disabled for self-hosted even with keys present", () => {
    vi.stubEnv("CREEM_API_KEY", "key");
    vi.stubEnv("CREEM_WEBHOOK_SECRET", "secret");
    expect(isBillingEnabled()).toBe(false);
  });
});
