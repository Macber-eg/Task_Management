import type { WorkspaceBillingEntity } from "../database/entities/workspace-billing.entity";
import { isBillingEnabled } from "./billing-config";

const ACTIVE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "scheduled_cancel",
]);

const PAID_THROUGH_PERIOD_STATUSES = new Set(["canceled"]);

export type BillingRow = Pick<
  WorkspaceBillingEntity,
  "foundingFree" | "status" | "currentPeriodEnd" | "trialEndsAt"
>;

/** Whether the workspace currently has paid-tier access, and why. */
export function computeEntitlement(billing: BillingRow) {
  if (!isBillingEnabled()) {
    return { active: true, reason: "billing_disabled" as const };
  }
  if (billing.foundingFree) {
    return { active: true, reason: "founding_free" as const };
  }
  if (billing.status && ACTIVE_STATUSES.has(billing.status)) {
    return { active: true, reason: "subscription" as const };
  }
  if (
    billing.status &&
    PAID_THROUGH_PERIOD_STATUSES.has(billing.status) &&
    billing.currentPeriodEnd &&
    billing.currentPeriodEnd.getTime() > Date.now()
  ) {
    return { active: true, reason: "paid_period" as const };
  }
  if (billing.trialEndsAt && billing.trialEndsAt.getTime() > Date.now()) {
    return { active: true, reason: "trial" as const };
  }
  return { active: false, reason: "expired" as const };
}
