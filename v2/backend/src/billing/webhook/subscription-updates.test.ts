import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSubscriptionUpdates } from "./subscription-updates";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildSubscriptionUpdates", () => {
  it("maps the event type to a status when the object has none", () => {
    expect(
      buildSubscriptionUpdates({
        type: "subscription.scheduled_cancel",
        data: { id: "sub_1" },
      }),
    ).toEqual({ status: "scheduled_cancel" });
  });

  it("leaves the status alone for an event it does not know", () => {
    expect(
      buildSubscriptionUpdates({ type: "subscription.update", data: {} }),
    ).toEqual({});
  });

  it("reads plan, interval, seats, customer and dates", () => {
    vi.stubEnv("CREEM_PRODUCT_TEAM_ANNUAL", "prod_ta");

    expect(
      buildSubscriptionUpdates({
        type: "subscription.active",
        data: {
          status: "active",
          product: { id: "prod_ta" },
          customer: { id: "cust_1" },
          items: [{ units: 4 }],
          current_period_end_date: "2026-09-01T00:00:00.000Z",
          canceledAt: null,
        },
      }),
    ).toEqual({
      status: "active",
      creemProductId: "prod_ta",
      plan: "team",
      billingInterval: "annual",
      seats: 4,
      creemCustomerId: "cust_1",
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      canceledAt: null,
    });
  });

  it("clears plan and interval for a product it does not sell", () => {
    expect(
      buildSubscriptionUpdates({
        type: "subscription.active",
        data: { product: { id: "prod_unknown" }, items: [{ units: 0 }] },
      }),
    ).toEqual({
      status: "active",
      creemProductId: "prod_unknown",
      plan: null,
      billingInterval: null,
    });
  });

  it("stores an unparseable period end as null", () => {
    expect(
      buildSubscriptionUpdates({
        type: "subscription.paid",
        data: { currentPeriodEndDate: "not a date" },
      }).currentPeriodEnd,
    ).toBeNull();
  });
});
