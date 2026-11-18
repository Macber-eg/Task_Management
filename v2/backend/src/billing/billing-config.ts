export { isBillingEnabled } from "../config/is-billing-enabled";

export type Plan = "personal" | "team";
export type BillingInterval = "monthly" | "annual";

const PRODUCT_ENV_KEYS: Record<Plan, Record<BillingInterval, string>> = {
  personal: {
    monthly: "CREEM_PRODUCT_PERSONAL_MONTHLY",
    annual: "CREEM_PRODUCT_PERSONAL_ANNUAL",
  },
  team: {
    monthly: "CREEM_PRODUCT_TEAM_MONTHLY",
    annual: "CREEM_PRODUCT_TEAM_ANNUAL",
  },
};

export function creemApiKey() {
  return process.env.CREEM_API_KEY ?? "";
}

export function creemWebhookSecret() {
  return process.env.CREEM_WEBHOOK_SECRET ?? "";
}

export function isCreemTestMode() {
  return process.env.CREEM_TEST_MODE === "true";
}

export function trialDays() {
  const parsed = Number.parseInt(process.env.BILLING_TRIAL_DAYS ?? "14", 10);
  return Number.isNaN(parsed) ? 14 : parsed;
}

export function foundingCutoff(): Date | null {
  const raw = process.env.BILLING_FOUNDING_CUTOFF;
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function productIdFor(
  plan: Plan,
  interval: BillingInterval,
): string | null {
  return process.env[PRODUCT_ENV_KEYS[plan][interval]] ?? null;
}

export function planForProductId(
  productId: string,
): { plan: Plan; interval: BillingInterval } | null {
  for (const plan of ["personal", "team"] as const) {
    for (const interval of ["monthly", "annual"] as const) {
      if (process.env[PRODUCT_ENV_KEYS[plan][interval]] === productId) {
        return { plan, interval };
      }
    }
  }
  return null;
}
