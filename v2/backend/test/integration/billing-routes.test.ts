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
import { CreemClient } from "../../src/billing/creem-client";
import { HTTPException } from "../../src/common/errors/http-exception";
import { WorkspaceBillingEntity } from "../../src/database/entities/workspace-billing.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import {
  creemDouble,
  resetCreemDouble,
} from "../support/fixtures/billing-creem-double";
import { stubBillingEnv } from "../support/fixtures/billing-env";
import { setBilling } from "../support/fixtures/billing-rows";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const DAY = 24 * 60 * 60 * 1000;
const creem = creemDouble();
let app: TestApp;

beforeAll(async () => {
  app = await createTestApp({ overrides: [[CreemClient, creem]] });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  resetCreemDouble(creem);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function post(path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signedInOwner() {
  const owner = await createWorkspaceMember(app.db, {
    role: "owner",
    userName: "Owner",
  });
  app.auth.signIn(owner.user);
  return owner;
}

describe("GET /api/billing/{workspaceId}", () => {
  it("reports billing as disabled with an always-active entitlement when self-hosted", async () => {
    const { workspace } = await signedInOwner();

    const response = await app.request(`/api/billing/${workspace.id}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      billingEnabled: false,
      entitlement: { active: true, reason: "billing_disabled" },
      foundingFree: false,
      plan: null,
      billingInterval: null,
      status: null,
      seats: 1,
      currentPeriodEnd: null,
      canceledAt: null,
      hasCustomer: false,
    });
    expect(typeof body.trialEndsAt).toBe("string");
  });

  it("starts the owner's trial on first read in cloud mode", async () => {
    stubBillingEnv({ BILLING_TRIAL_DAYS: "7" });
    const { workspace } = await signedInOwner();

    const response = await app.request(`/api/billing/${workspace.id}`);

    const body = (await response.json()) as {
      billingEnabled: boolean;
      entitlement: { reason: string };
      trialEndsAt: string;
    };
    expect(body.billingEnabled).toBe(true);
    expect(body.entitlement).toEqual({ active: true, reason: "trial" });
    const remaining = new Date(body.trialEndsAt).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(6 * DAY);
    expect(remaining).toBeLessThanOrEqual(7 * DAY);
  });

  it("marks workspaces created before the founding cutoff as free", async () => {
    stubBillingEnv({ BILLING_FOUNDING_CUTOFF: "2999-01-01" });
    const { workspace } = await signedInOwner();

    const response = await app.request(`/api/billing/${workspace.id}`);

    expect(await response.json()).toMatchObject({
      foundingFree: true,
      trialEndsAt: null,
      entitlement: { active: true, reason: "founding_free" },
    });
  });

  it("answers 404 to a non-member", async () => {
    const { workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    app.auth.signIn(await createUser(app.db));

    const response = await app.request(`/api/billing/${workspace.id}`);

    expect(response.status).toBe(404);
    expect(await app.db.count(WorkspaceBillingEntity)).toBe(0);
  });

  it("is readable with an API key", async () => {
    const { user, workspace } = await signedInOwner();
    app.auth.signInAs(await createApiKeyPrincipal(app.db, user));

    expect((await app.request(`/api/billing/${workspace.id}`)).status).toBe(
      200,
    );
  });
});

describe("POST /api/billing/{workspaceId}/checkout", () => {
  beforeEach(() => {
    stubBillingEnv({ CREEM_PRODUCT_TEAM_MONTHLY: "prod_team_monthly" });
  });

  it("creates a team checkout with one seat per member, without caching the response", async () => {
    vi.stubEnv("KANEO_CLIENT_URL", "https://app.example.test");
    const { user, workspace } = await signedInOwner();
    const colleague = await createUser(app.db);
    await addWorkspaceMember(app.db, workspace.id, colleague.id, "member");

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      checkoutUrl: "https://checkout.example.invalid/session",
    });
    expect(creem.createCheckoutSession).toHaveBeenCalledWith({
      productId: "prod_team_monthly",
      units: 2,
      successUrl:
        "https://app.example.test/dashboard/settings/workspace/billing?checkout=success",
      requestId: expect.any(String),
      customerEmail: user.email,
      metadata: { workspaceId: workspace.id, plan: "team", interval: "monthly" },
    });
  });

  it.each([
    ["a read-only key", { task: ["read"] }],
    ["an unrestricted key", null],
  ])("rejects %s even for an owner", async (_label, permissions) => {
    const { user, workspace } = await signedInOwner();
    app.auth.signInAs(await createApiKeyPrincipal(app.db, user, permissions));

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });

    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toMatchObject({
      code: "SESSION_REQUIRED",
    });
    expect(creem.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses members who are not owners or admins", async () => {
    const { workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const member = await createUser(app.db);
    await addWorkspaceMember(app.db, workspace.id, member.id, "member");
    app.auth.signIn(member);

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });

    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Only workspace owners and admins can manage billing",
    });
  });

  it("lets a workspace admin check out", async () => {
    const { workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const admin = await createUser(app.db);
    await addWorkspaceMember(app.db, workspace.id, admin.id, "admin");
    app.auth.signIn(admin);

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });

    expect(response.status).toBe(200);
  });

  it("answers 404 to a non-member", async () => {
    const { workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    app.auth.signIn(await createUser(app.db));

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });

    expect(response.status).toBe(404);
  });

  it("validates the plan and interval", async () => {
    const { workspace } = await signedInOwner();

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "enterprise",
      interval: "monthly",
    });

    expect(response.status).toBe(400);
    expect(creem.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses a plan without a configured product", async () => {
    const { workspace } = await signedInOwner();

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "personal",
      interval: "annual",
    });

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Unknown plan",
    });
  });

  it("refuses a second subscription", async () => {
    const { workspace } = await signedInOwner();
    await setBilling(app.db, workspace.id, { status: "active" });

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Workspace already has an active subscription",
    });
  });

  it("answers 400 when billing is not enabled", async () => {
    vi.unstubAllEnvs();
    const { workspace } = await signedInOwner();

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Billing is not enabled",
    });
  });

  it("answers 502 when Creem fails", async () => {
    const { workspace } = await signedInOwner();
    creem.createCheckoutSession.mockRejectedValueOnce(
      new HTTPException(502, { message: "Billing provider request failed" }),
    );

    const response = await post(`/api/billing/${workspace.id}/checkout`, {
      plan: "team",
      interval: "monthly",
    });

    expect(response.status).toBe(502);
  });
});

describe("POST /api/billing/{workspaceId}/portal", () => {
  beforeEach(() => {
    stubBillingEnv();
  });

  it("answers 400 until a billing customer exists", async () => {
    const { workspace } = await signedInOwner();

    const response = await post(`/api/billing/${workspace.id}/portal`);

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "No billing customer exists for this workspace yet",
    });
  });

  it("returns the customer's portal link without caching it", async () => {
    const { workspace } = await signedInOwner();
    await setBilling(app.db, workspace.id, { creemCustomerId: "cust_1" });

    const response = await post(`/api/billing/${workspace.id}/portal`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      portalUrl: "https://portal.example.invalid/link",
    });
    expect(creem.createCustomerPortalLink).toHaveBeenCalledWith("cust_1");
  });

  it("rejects API keys and missing sessions", async () => {
    const { user, workspace } = await signedInOwner();
    app.auth.signInAs(await createApiKeyPrincipal(app.db, user));
    expect((await post(`/api/billing/${workspace.id}/portal`)).status).toBe(
      403,
    );

    app.auth.signOut();
    expect((await post(`/api/billing/${workspace.id}/portal`)).status).toBe(
      401,
    );
    expect(creem.createCustomerPortalLink).not.toHaveBeenCalled();
  });
});
