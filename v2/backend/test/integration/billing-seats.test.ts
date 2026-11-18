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
import { SeatReconciliation } from "../../src/billing/jobs/seat-reconciliation.service";
import { SeatSyncService } from "../../src/billing/seat-sync.service";
import type { WorkspaceBillingEntity } from "../../src/database/entities/workspace-billing.entity";
import { JobLeaseEntity } from "../../src/database/entities/job-lease.entity";
import { WorkspaceMemberLifecycleService } from "../../src/workspace-members/workspace-member-lifecycle.service";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import {
  creemDouble,
  resetCreemDouble,
} from "../support/fixtures/billing-creem-double";
import { stubBillingEnv } from "../support/fixtures/billing-env";
import { readBilling, setBilling } from "../support/fixtures/billing-rows";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

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
  stubBillingEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function addMember(workspaceId: string) {
  const member = await createWorkspaceMember(app.db);
  await addWorkspaceMember(app.db, workspaceId, member.user.id, "member");
}

function teamBilling(
  workspaceId: string,
  overrides: Partial<WorkspaceBillingEntity> = {},
) {
  return setBilling(app.db, workspaceId, {
    plan: "team",
    status: "active",
    seats: 1,
    creemSubscriptionId: `sub-${workspaceId}`,
    creemProductId: "prod_team_monthly",
    ...overrides,
  });
}

async function seatsOf(workspaceId: string) {
  return (await readBilling(app.db, workspaceId)).seats;
}

function syncWorkspaceSeats(workspaceId: string) {
  return app.get(SeatSyncService).syncWorkspaceSeats(workspaceId);
}

function reconcileWorkspaceSeats() {
  return app.get(SeatReconciliation).reconcileWorkspaceSeats();
}

describe("API integration: seat sync", () => {
  it("updates Creem and persists the new seat count when members change", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 1 });
    await addMember(owner.workspace.id);

    await syncWorkspaceSeats(owner.workspace.id);

    expect(creem.updateSubscriptionSeats).toHaveBeenCalledWith({
      subscriptionId: `sub-${owner.workspace.id}`,
      productId: "prod_team_monthly",
      units: 2,
    });
    expect(await seatsOf(owner.workspace.id)).toBe(2);
  });

  it("leaves the stored seat count alone when the provider rejects the update", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 1 });
    await addMember(owner.workspace.id);
    creem.updateSubscriptionSeats.mockRejectedValueOnce(new Error("Status 403"));

    await expect(syncWorkspaceSeats(owner.workspace.id)).rejects.toThrow(
      "Status 403",
    );

    expect(await seatsOf(owner.workspace.id)).toBe(1);
  });

  it("does nothing when the seat count already matches", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 1 });

    await syncWorkspaceSeats(owner.workspace.id);

    expect(creem.updateSubscriptionSeats).not.toHaveBeenCalled();
  });

  it("skips personal plans", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, {
      plan: "personal",
      creemProductId: "prod_personal_monthly",
    });
    await addMember(owner.workspace.id);

    await syncWorkspaceSeats(owner.workspace.id);

    expect(creem.updateSubscriptionSeats).not.toHaveBeenCalled();
  });

  it("skips workspaces without an active subscription", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { status: "canceled" });
    await addMember(owner.workspace.id);

    await syncWorkspaceSeats(owner.workspace.id);

    expect(creem.updateSubscriptionSeats).not.toHaveBeenCalled();
  });

  it("does nothing on a self-hosted instance", async () => {
    vi.unstubAllEnvs();
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 1 });
    await addMember(owner.workspace.id);

    await syncWorkspaceSeats(owner.workspace.id);

    expect(creem.updateSubscriptionSeats).not.toHaveBeenCalled();
  });

  it("follows membership changes through the member lifecycle", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 1 });
    await addMember(owner.workspace.id);

    await app
      .get(WorkspaceMemberLifecycleService)
      .handleMemberAdded(owner.workspace.id, owner.user.id);

    await vi.waitFor(async () => {
      expect(await seatsOf(owner.workspace.id)).toBe(2);
    });
    expect(creem.updateSubscriptionSeats).toHaveBeenCalledWith(
      expect.objectContaining({ units: 2 }),
    );
  });
});

describe("API integration: seat reconciliation", () => {
  it("repairs a workspace whose seat count drifted from its membership", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 1 });
    await addMember(owner.workspace.id);
    await addMember(owner.workspace.id);

    await reconcileWorkspaceSeats();

    expect(creem.updateSubscriptionSeats).toHaveBeenCalledWith({
      subscriptionId: `sub-${owner.workspace.id}`,
      productId: "prod_team_monthly",
      units: 3,
    });
    expect(await seatsOf(owner.workspace.id)).toBe(3);
    expect(await app.db.count(JobLeaseEntity)).toBe(0);
  });

  it("repairs drift downwards after members leave", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 5 });

    await reconcileWorkspaceSeats();

    expect(creem.updateSubscriptionSeats).toHaveBeenCalledWith(
      expect.objectContaining({ units: 1 }),
    );
    expect(await seatsOf(owner.workspace.id)).toBe(1);
  });

  it("touches nothing when every workspace is already in sync", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 1 });

    await reconcileWorkspaceSeats();

    expect(creem.updateSubscriptionSeats).not.toHaveBeenCalled();
  });

  it("ignores personal plans and inactive subscriptions", async () => {
    const personal = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(personal.workspace.id, { plan: "personal", seats: 9 });
    const canceled = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(canceled.workspace.id, { status: "canceled", seats: 9 });

    await reconcileWorkspaceSeats();

    expect(creem.updateSubscriptionSeats).not.toHaveBeenCalled();
  });

  it("keeps going when one workspace fails to sync", async () => {
    const first = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(first.workspace.id, { seats: 4 });
    const second = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(second.workspace.id, { seats: 4 });
    creem.updateSubscriptionSeats.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );

    await expect(reconcileWorkspaceSeats()).resolves.toEqual({
      degraded: true,
    });

    expect(creem.updateSubscriptionSeats).toHaveBeenCalledTimes(2);
    const seats = [
      await seatsOf(first.workspace.id),
      await seatsOf(second.workspace.id),
    ].sort();
    expect(seats).toEqual([1, 4]);
  });

  it("skips the run while another replica holds the lease", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    await teamBilling(owner.workspace.id, { seats: 5 });
    await app.dataSource.query(
      `INSERT INTO job_lease ("name", "owner", "expires_at")
       VALUES ('seat-reconciliation', 'other-replica', now() + interval '10 minutes')`,
    );

    await expect(reconcileWorkspaceSeats()).resolves.toEqual({
      degraded: false,
    });

    expect(creem.updateSubscriptionSeats).not.toHaveBeenCalled();
  });
});
