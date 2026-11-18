import { vi } from "vitest";

/**
 * Turns Kaneo Cloud billing on for the current test. Undo with
 * `vi.unstubAllEnvs()`. The keys are dummies: Creem is always a double.
 */
export function stubBillingEnv(extra: Record<string, string> = {}): void {
  const values: Record<string, string> = {
    KANEO_CLOUD: "true",
    CREEM_API_KEY: "creem_test_dummy",
    CREEM_WEBHOOK_SECRET: "whsec_dummy",
    ...extra,
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
