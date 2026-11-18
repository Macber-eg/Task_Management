import { createHmac } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { failPlanLookup } = vi.hoisted(() => ({
  failPlanLookup: { next: false },
}));
vi.mock("../../src/billing/billing-config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/billing/billing-config")>();
  return {
    ...actual,
    planForProductId: (productId: string) => {
      if (failPlanLookup.next) {
        failPlanLookup.next = false;
        throw new Error("apply failed");
      }
      return actual.planForProductId(productId);
    },
  };
});

import type { BillingWebhookEvent } from "../../src/billing/webhook/billing-webhook-event";
import { BillingWebhookService } from "../../src/billing/webhook/billing-webhook.service";
import { BillingEventEntity } from "../../src/database/entities/billing-event.entity";
import type { WorkspaceBillingEntity } from "../../src/database/entities/workspace-billing.entity";
import { stubBillingEnv } from "../support/fixtures/billing-env";
import { readBilling, setBilling } from "../support/fixtures/billing-rows";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const PERIOD_END = new Date("2026-09-01T00:00:00.000Z");
const SECRET = "whsec_dummy";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  failPlanLookup.next = false;
  stubBillingEnv({ CREEM_PRODUCT_TEAM_MONTHLY: "prod_team_monthly" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function handleWebhook(event: BillingWebhookEvent) {
  return app.get(BillingWebhookService).handleWebhook(event);
}

async function seedBilling(
  workspaceId: string,
  overrides: Partial<WorkspaceBillingEntity> = {},
) {
  await setBilling(app.db, workspaceId, {
    plan: "team",
    status: "active",
    seats: 1,
    creemSubscriptionId: `sub-${workspaceId}`,
    creemProductId: "prod_team_monthly",
    currentPeriodEnd: PERIOD_END,
    ...overrides,
  });
}

function subscriptionEvent(
  id: string,
  workspaceId: string,
  data: Record<string, unknown> = {},
): BillingWebhookEvent {
  return {
    id,
    type: "subscription.canceled",
    data: {
      id: `sub-${workspaceId}`,
      status: "canceled",
      product: { id: "prod_team_monthly" },
      ...data,
    },
  };
}

function signedDelivery(body: string, secret = SECRET): RequestInit {
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return {
    method: "POST",
    headers: { "content-type": "application/json", "creem-signature": signature },
    body,
  };
}

describe("API integration: billing webhooks", () => {
  it("applies a subscription event once and suppresses the replay", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await seedBilling(owner.workspace.id);
    const event = subscriptionEvent("evt-dup", owner.workspace.id);

    expect(await handleWebhook(event)).toEqual({
      processed: true,
      duplicate: false,
    });
    expect(await handleWebhook(event)).toEqual({
      processed: false,
      duplicate: true,
    });

    expect((await readBilling(app.db, owner.workspace.id)).status).toBe(
      "canceled",
    );
  });

  it("leaves the event replayable when applying it fails", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await seedBilling(owner.workspace.id);
    const event = subscriptionEvent("evt-fail", owner.workspace.id);

    failPlanLookup.next = true;
    await expect(handleWebhook(event)).rejects.toThrow("apply failed");

    expect(await app.db.count(BillingEventEntity)).toBe(0);
    expect((await readBilling(app.db, owner.workspace.id)).status).toBe(
      "active",
    );

    expect(await handleWebhook(event)).toEqual({
      processed: true,
      duplicate: false,
    });
    expect((await readBilling(app.db, owner.workspace.id)).status).toBe(
      "canceled",
    );
  });

  it("keeps a known period end when a later event omits it", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await seedBilling(owner.workspace.id);

    await handleWebhook({
      id: "evt-paid",
      type: "subscription.paid",
      data: { id: `sub-${owner.workspace.id}`, status: "active" },
    });

    expect(
      (await readBilling(app.db, owner.workspace.id)).currentPeriodEnd,
    ).toEqual(PERIOD_END);
  });

  it("keeps a recorded cancellation when a later event omits it", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const canceledAt = new Date("2026-08-20T00:00:00.000Z");
    await seedBilling(owner.workspace.id, { canceledAt });

    await handleWebhook({
      id: "evt-active",
      type: "subscription.active",
      data: { id: `sub-${owner.workspace.id}`, status: "active" },
    });

    expect((await readBilling(app.db, owner.workspace.id)).canceledAt).toEqual(
      canceledAt,
    );
  });

  it("clears the cancellation when the provider sends an explicit null", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await seedBilling(owner.workspace.id, {
      canceledAt: new Date("2026-08-20T00:00:00.000Z"),
    });

    await handleWebhook({
      id: "evt-resumed",
      type: "subscription.active",
      data: {
        id: `sub-${owner.workspace.id}`,
        status: "active",
        canceled_at: null,
      },
    });

    expect(
      (await readBilling(app.db, owner.workspace.id)).canceledAt,
    ).toBeNull();
  });

  it("links a completed checkout to the workspace named in its metadata", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await setBilling(app.db, owner.workspace.id, {});

    expect(
      await handleWebhook({
        id: "evt-checkout",
        type: "checkout.completed",
        data: {
          metadata: { workspaceId: owner.workspace.id },
          product: { id: "prod_team_monthly" },
          customer: { id: "cust_1" },
          subscription: { id: "sub_new", status: "active" },
        },
      }),
    ).toEqual({ processed: true, duplicate: false });

    expect(await readBilling(app.db, owner.workspace.id)).toMatchObject({
      creemCustomerId: "cust_1",
      creemSubscriptionId: "sub_new",
      creemProductId: "prod_team_monthly",
      plan: "team",
      billingInterval: "monthly",
      status: "active",
    });
  });

  it("does not process a completed checkout without a workspace", async () => {
    expect(
      await handleWebhook({ type: "checkout.completed", data: {} }),
    ).toEqual({ processed: false, duplicate: false });
  });

  it("adopts an unknown subscription id for the workspace in its metadata", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await setBilling(app.db, owner.workspace.id, {});

    await handleWebhook({
      type: "subscription.active",
      data: {
        id: "sub_adopted",
        status: "active",
        metadata: { workspaceId: owner.workspace.id },
        items: [{ units: 3 }],
      },
    });

    expect(await readBilling(app.db, owner.workspace.id)).toMatchObject({
      creemSubscriptionId: "sub_adopted",
      status: "active",
      seats: 3,
    });
  });

  describe("POST /api/billing/webhook", () => {
    it("answers 404 when billing is not enabled", async () => {
      vi.unstubAllEnvs();
      const body = JSON.stringify({ id: "evt", type: "subscription.paid" });

      const response = await app.request(
        "/api/billing/webhook",
        signedDelivery(body),
      );

      expect(response.status).toBe(404);
      expect(await readErrorBody(response)).toMatchObject({
        message: "Not found",
      });
    });

    it("answers 400 to a delivery signed with another secret", async () => {
      const body = JSON.stringify({ id: "evt", type: "subscription.paid" });

      const response = await app.request(
        "/api/billing/webhook",
        signedDelivery(body, "whsec_wrong"),
      );

      expect(response.status).toBe(400);
      expect(await readErrorBody(response)).toMatchObject({
        message: "Invalid signature",
      });
    });

    it("answers 400 to an unsigned delivery", async () => {
      const response = await app.request("/api/billing/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "evt", type: "subscription.paid" }),
      });

      expect(response.status).toBe(400);
    });

    it("applies a signed delivery without a session, once per event id", async () => {
      const owner = await createWorkspaceMember(app.db, { role: "owner" });
      await seedBilling(owner.workspace.id);
      app.auth.signOut();
      // Signed over the exact bytes, whitespace included.
      const body = `{ "id": "evt-http", "type": "subscription.canceled",
        "object": { "id": "sub-${owner.workspace.id}", "status": "canceled" } }`;

      const first = await app.request(
        "/api/billing/webhook",
        signedDelivery(body),
      );
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ processed: true, duplicate: false });

      const replay = await app.request(
        "/api/billing/webhook",
        signedDelivery(body),
      );
      expect(await replay.json()).toEqual({
        processed: false,
        duplicate: true,
      });
      expect((await readBilling(app.db, owner.workspace.id)).status).toBe(
        "canceled",
      );
    });
  });
});
