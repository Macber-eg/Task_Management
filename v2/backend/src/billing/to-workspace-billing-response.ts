import type { WorkspaceBillingEntity } from "../database/entities/workspace-billing.entity";
import { isBillingEnabled } from "./billing-config";
import { computeEntitlement } from "./compute-entitlement";

export function toWorkspaceBillingResponse(billing: WorkspaceBillingEntity) {
  return {
    billingEnabled: isBillingEnabled(),
    entitlement: computeEntitlement(billing),
    foundingFree: billing.foundingFree,
    trialEndsAt: billing.trialEndsAt,
    plan: billing.plan,
    billingInterval: billing.billingInterval,
    status: billing.status,
    seats: billing.seats,
    currentPeriodEnd: billing.currentPeriodEnd,
    canceledAt: billing.canceledAt,
    hasCustomer: Boolean(billing.creemCustomerId),
  };
}
