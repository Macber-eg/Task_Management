import type { WorkspaceBillingEntity } from "../../database/entities/workspace-billing.entity";
import { planForProductId } from "../billing-config";
import type { BillingWebhookEvent } from "./billing-webhook-event";

const SUBSCRIPTION_EVENT_STATUS: Record<string, string> = {
  "subscription.active": "active",
  "subscription.trialing": "trialing",
  "subscription.paid": "active",
  "subscription.scheduled_cancel": "scheduled_cancel",
  "subscription.canceled": "canceled",
  "subscription.past_due": "past_due",
  "subscription.expired": "expired",
  "subscription.paused": "paused",
};

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The billing columns a `subscription.*` event changes. A field the event
 * omits keeps its stored value; an explicit null clears it.
 */
export function buildSubscriptionUpdates(event: BillingWebhookEvent) {
  const object = event.data;
  const productId = object.product?.id;
  const mapped = productId ? planForProductId(productId) : null;
  const units = object.items?.[0]?.units;

  const updates: Partial<WorkspaceBillingEntity> = {};
  const status = object.status ?? SUBSCRIPTION_EVENT_STATUS[event.type];
  if (status !== undefined) {
    updates.status = status;
  }

  const periodEnd =
    object.current_period_end_date !== undefined
      ? object.current_period_end_date
      : object.currentPeriodEndDate;
  if (periodEnd !== undefined) {
    updates.currentPeriodEnd = parseDate(periodEnd);
  }

  const canceledAt =
    object.canceled_at !== undefined ? object.canceled_at : object.canceledAt;
  if (canceledAt !== undefined) {
    updates.canceledAt = parseDate(canceledAt);
  }

  if (productId) {
    updates.creemProductId = productId;
    updates.plan = mapped?.plan ?? null;
    updates.billingInterval = mapped?.interval ?? null;
  }
  if (typeof units === "number" && units > 0) {
    updates.seats = units;
  }
  if (object.customer?.id) {
    updates.creemCustomerId = object.customer.id;
  }

  return updates;
}
