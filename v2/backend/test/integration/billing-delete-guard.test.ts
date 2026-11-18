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
import { AccountDataDeletionService } from "../../src/admin/account-deletion/account-data-deletion.service";
import { UserEntity } from "../../src/database/entities/user.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { WorkspaceEntity } from "../../src/database/entities/workspace.entity";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { signUpBrowser } from "../support/browser";
import { stubBillingEnv } from "../support/fixtures/billing-env";
import { setBilling } from "../support/fixtures/billing-rows";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import {
  realtimeDouble,
  resetRealtimeDouble,
} from "../support/realtime-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const ACTIVE_SUBSCRIPTION = {
  creemSubscriptionId: "sub_active",
  creemProductId: "prod_1",
  plan: "team",
  status: "active",
};

const realtime = realtimeDouble();
let app: TestApp;

beforeAll(async () => {
  app = await createTestApp({
    realAuth: true,
    overrides: [[RealtimeConnections, realtime]],
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  resetRealtimeDouble(realtime);
  stubBillingEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function deleteAccountData(userId: string) {
  return app.get(AccountDataDeletionService).deleteAccountData(userId);
}

function workspaceCount(id: string) {
  return app.db.countBy(WorkspaceEntity, { id });
}

describe("API integration: deleting paid workspaces", () => {
  it("refuses account deletion while a workspace still has an active subscription", async () => {
    const owner = await createWorkspaceMember(app.db, {
      role: "owner",
      workspaceName: "Paid Space",
    });
    await setBilling(app.db, owner.workspace.id, ACTIVE_SUBSCRIPTION);

    await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
      /"Paid Space" still has an active subscription/,
    );
    expect(await workspaceCount(owner.workspace.id)).toBe(1);
  });

  it("allows account deletion once the subscription is cancelled", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await setBilling(app.db, owner.workspace.id, {
      creemSubscriptionId: "sub_gone",
      status: "canceled",
    });

    await deleteAccountData(owner.user.id);

    expect(await workspaceCount(owner.workspace.id)).toBe(0);
  });

  it("allows account deletion for a workspace on the free trial", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await setBilling(app.db, owner.workspace.id, {
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await deleteAccountData(owner.user.id);

    expect(await workspaceCount(owner.workspace.id)).toBe(0);
  });

  it("does not guard anything on a self-hosted instance", async () => {
    vi.unstubAllEnvs();
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await setBilling(app.db, owner.workspace.id, ACTIVE_SUBSCRIPTION);

    await deleteAccountData(owner.user.id);

    expect(await workspaceCount(owner.workspace.id)).toBe(0);
  });

  it("refuses workspace deletion through the API while the subscription is active", async () => {
    const owner = await signUpBrowser(app, "paid-owner@example.com", "Paid Owner");
    const created = await owner.post("/api/auth/organization/create", {
      name: "Paid Space",
      slug: "paid-space",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };
    await setBilling(app.db, workspace.id, ACTIVE_SUBSCRIPTION);

    const deleted = await owner.post("/api/auth/organization/delete", {
      organizationId: workspace.id,
    });

    expect(deleted.status).toBe(409);
    expect(await deleted.json()).toMatchObject({
      code: "WORKSPACE_HAS_ACTIVE_SUBSCRIPTION",
      message:
        '"Paid Space" still has an active subscription. Cancel it in billing settings before deleting.',
    });
    expect(await workspaceCount(workspace.id)).toBe(1);
  });

  it("refuses to remove the only member of a workspace with an active subscription", async () => {
    // The first account on an empty instance becomes its administrator.
    const admin = await signUpBrowser(app, "admin@example.com", "Instance Admin");
    const owner = await createWorkspaceMember(app.db, {
      role: "owner",
      workspaceName: "Paid Space",
    });
    await setBilling(app.db, owner.workspace.id, ACTIVE_SUBSCRIPTION);

    const response = await admin.post("/api/auth/admin/remove-user", {
      userId: owner.user.id,
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(
      /Paid Space.* still has an active subscription/,
    );
    expect(await app.db.countBy(UserEntity, { id: owner.user.id })).toBe(1);
    expect(await workspaceCount(owner.workspace.id)).toBe(1);
    expect(
      await app.db.countBy(WorkspaceUserEntity, { userId: owner.user.id }),
    ).toBe(1);
  });
});
