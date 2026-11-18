import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccountDataDeletionService } from "../../src/admin/account-deletion/account-data-deletion.service";
import { WorkspaceBillingService } from "../../src/billing/workspace-billing.service";
import { UserEntity } from "../../src/database/entities/user.entity";
import { WorkspaceBillingEntity } from "../../src/database/entities/workspace-billing.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { setBilling } from "../support/fixtures/billing-rows";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const DAY = 24 * 60 * 60 * 1000;

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
});

function getOrCreateWorkspaceBilling(workspaceId: string) {
  return app.get(WorkspaceBillingService).getOrCreateWorkspaceBilling(workspaceId);
}

async function addWorkspaceOwnedBy(userId: string) {
  const workspace = await createWorkspace(app.db, { name: "Extra Workspace" });
  await addWorkspaceMember(app.db, workspace.id, userId, "owner");
  return workspace;
}

describe("trial is granted once per owner", () => {
  it("gives a first workspace a full trial", async () => {
    const { workspace } = await createWorkspaceMember(app.db, { role: "owner" });

    const billing = await getOrCreateWorkspaceBilling(workspace.id);

    expect(billing.trialEndsAt).not.toBeNull();
    const remaining = (billing.trialEndsAt as Date).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(13 * DAY);
    expect(remaining).toBeLessThanOrEqual(14 * DAY);
  });

  it("does not extend the trial when the owner makes another workspace", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const first = await getOrCreateWorkspaceBilling(workspace.id);

    const second = await addWorkspaceOwnedBy(user.id);
    const secondBilling = await getOrCreateWorkspaceBilling(second.id);

    expect(secondBilling.trialEndsAt?.getTime()).toBe(
      first.trialEndsAt?.getTime(),
    );
  });

  it("starts a later workspace unentitled once the owner's trial has lapsed", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    await getOrCreateWorkspaceBilling(workspace.id);

    const lapsed = new Date(Date.now() - DAY);
    await app.db.update(
      WorkspaceBillingEntity,
      { workspaceId: workspace.id },
      { trialEndsAt: lapsed },
    );

    const second = await addWorkspaceOwnedBy(user.id);
    const secondBilling = await getOrCreateWorkspaceBilling(second.id);

    expect(secondBilling.trialEndsAt?.getTime()).toBe(lapsed.getTime());
    expect(secondBilling.trialEndsAt?.getTime()).toBeLessThan(Date.now());
  });

  it("keeps trials separate for different owners", async () => {
    const { workspace: aWorkspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    await setBilling(app.db, aWorkspace.id, {
      trialEndsAt: new Date(Date.now() - DAY),
    });

    const { workspace: bWorkspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const bBilling = await getOrCreateWorkspaceBilling(bWorkspace.id);

    expect(bBilling.trialEndsAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it("leaves an existing billing row untouched", async () => {
    const { workspace } = await createWorkspaceMember(app.db, { role: "owner" });
    const pinned = new Date(Date.now() + 99 * DAY);
    await setBilling(app.db, workspace.id, { trialEndsAt: pinned });

    const billing = await getOrCreateWorkspaceBilling(workspace.id);

    expect(billing.trialEndsAt?.getTime()).toBe(pinned.getTime());
  });

  it("does not hand out a new trial after the account is deleted", async () => {
    const first = await createWorkspaceMember(app.db, { role: "owner" });
    const firstBilling = await getOrCreateWorkspaceBilling(first.workspace.id);
    expect(firstBilling.trialEndsAt).not.toBeNull();

    await app.get(AccountDataDeletionService).deleteAccountData(first.user.id);
    await app.db.delete(UserEntity, { id: first.user.id });

    const returning = await createWorkspaceMember(app.db, { role: "owner" });
    await app.db.update(
      UserEntity,
      { id: returning.user.id },
      { email: first.user.email },
    );

    const secondBilling = await getOrCreateWorkspaceBilling(
      returning.workspace.id,
    );

    expect(secondBilling.trialEndsAt?.getTime()).toBe(
      firstBilling.trialEndsAt?.getTime(),
    );
  });

  it("treats a plus-addressed signup as the same trial identity", async () => {
    const first = await createWorkspaceMember(app.db, { role: "owner" });
    await app.db.update(
      UserEntity,
      { id: first.user.id },
      { email: "trial-abuse@example.com" },
    );
    const firstBilling = await getOrCreateWorkspaceBilling(first.workspace.id);

    const second = await createWorkspaceMember(app.db, { role: "owner" });
    await app.db.update(
      UserEntity,
      { id: second.user.id },
      { email: "trial-abuse+again@example.com" },
    );
    const secondBilling = await getOrCreateWorkspaceBilling(
      second.workspace.id,
    );

    expect(secondBilling.trialEndsAt?.getTime()).toBe(
      firstBilling.trialEndsAt?.getTime(),
    );
  });
});
