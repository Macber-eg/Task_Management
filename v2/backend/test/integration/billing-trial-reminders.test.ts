import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { TrialReminders } from "../../src/billing/jobs/trial-reminders.service";
import { BillingReminderSentEntity } from "../../src/database/entities/billing-reminder-sent.entity";
import type { WorkspaceBillingEntity } from "../../src/database/entities/workspace-billing.entity";
import { EmailService } from "../../src/email/email.service";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { stubBillingEnv } from "../support/fixtures/billing-env";
import { setBilling } from "../support/fixtures/billing-rows";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const DAY = 24 * 60 * 60 * 1000;

let app: TestApp;
let send: MockInstance<EmailService["sendTrialReminderEmail"]>;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  app.emails.clear();
  stubBillingEnv({
    SMTP_HOST: "smtp.example.com",
    SMTP_FROM: "kaneo@example.com",
    BILLING_REMINDER_MAX_PER_RUN: "2",
  });
  send = vi.spyOn(app.get(EmailService), "sendTrialReminderEmail");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function checkTrialReminders() {
  return app.get(TrialReminders).checkTrialReminders();
}

async function seedTrial(
  trialEndsAt: Date | null,
  overrides: Partial<WorkspaceBillingEntity> = {},
) {
  const member = await createWorkspaceMember(app.db, {
    role: "owner",
    workspaceName: `WS-${randomUUID().slice(0, 6)}`,
  });
  await setBilling(app.db, member.workspace.id, { trialEndsAt, ...overrides });
  return member;
}

async function addWorkspaceOwnedBy(userId: string, trialEndsAt: Date) {
  const workspace = await createWorkspace(app.db, {
    name: `Extra-${randomUUID().slice(0, 6)}`,
  });
  await addWorkspaceMember(app.db, workspace.id, userId, "owner");
  await setBilling(app.db, workspace.id, { trialEndsAt });
}

function recipients() {
  return send.mock.calls.map((call) => call[0]);
}

function sentData(index = 0) {
  const call = send.mock.calls[index];
  if (!call) throw new Error(`No email number ${index}`);
  const [, subject, data] = call;
  return { subject, data };
}

describe("trial reminder emails", () => {
  it("warns the owner before the trial ends", async () => {
    const { user, workspace } = await seedTrial(
      new Date(Date.now() + 2.5 * DAY),
    );

    await checkTrialReminders();

    expect(recipients()).toEqual([user.email]);
    const { subject, data } = sentData();
    expect(subject).toBe(`Your ${workspace.name} trial ends in 3 days`);
    expect(data).toMatchObject({
      workspaceName: workspace.name,
      daysLeft: 3,
      trialDays: 14,
    });
    expect(app.emails.to(user.email)).toEqual([
      expect.objectContaining({ subject, from: "kaneo@example.com" }),
    ]);
  });

  it("emails once the trial has lapsed", async () => {
    vi.stubEnv("KANEO_CLIENT_URL", "https://app.example.test/");
    const { user } = await seedTrial(new Date(Date.now() - DAY));

    await checkTrialReminders();

    expect(recipients()).toEqual([user.email]);
    const { subject, data } = sentData();
    expect(subject).toContain("has ended");
    expect(data.daysLeft).toBe(0);
    expect(data.billingUrl).toBe(
      "https://app.example.test/dashboard/settings/workspace/billing",
    );
  });

  it("never sends the same reminder twice", async () => {
    await seedTrial(new Date(Date.now() - DAY));

    await checkTrialReminders();
    await checkTrialReminders();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("ignores trials that are neither ending soon nor lapsed", async () => {
    await seedTrial(new Date(Date.now() + 9 * DAY));

    await checkTrialReminders();

    expect(send).not.toHaveBeenCalled();
  });

  it("skips founding-free workspaces and paying subscribers", async () => {
    await seedTrial(null, { foundingFree: true });
    await seedTrial(new Date(Date.now() - DAY), {
      creemSubscriptionId: `sub_${randomUUID()}`,
      status: "active",
    });

    await checkTrialReminders();

    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing without SMTP or outside cloud mode", async () => {
    await seedTrial(new Date(Date.now() - DAY));

    vi.stubEnv("SMTP_HOST", "");
    await checkTrialReminders();
    vi.unstubAllEnvs();
    await checkTrialReminders();

    expect(send).not.toHaveBeenCalled();
    expect(await app.db.count(BillingReminderSentEntity)).toBe(0);
  });

  it("records what it sent so a later run can be audited", async () => {
    const { workspace } = await seedTrial(new Date(Date.now() - DAY));

    await checkTrialReminders();

    const rows = await app.db.find(BillingReminderSentEntity, {
      where: { workspaceId: workspace.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reminderType).toBe("trial_expired");
  });

  it("caps how many it sends per run so the provider is not flooded", async () => {
    for (let i = 0; i < 5; i++) {
      await seedTrial(new Date(Date.now() - (i + 1) * DAY));
    }

    await checkTrialReminders();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("shares one cap across both reminder types and leaves unsent rows for the next run", async () => {
    for (let i = 0; i < 2; i++) {
      await seedTrial(new Date(Date.now() + 2.5 * DAY));
      await seedTrial(new Date(Date.now() - DAY));
    }

    await checkTrialReminders();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await app.db.count(BillingReminderSentEntity)).toBe(2);

    await checkTrialReminders();
    expect(send).toHaveBeenCalledTimes(4);
    expect(new Set(recipients()).size).toBe(4);
    expect(await app.db.count(BillingReminderSentEntity)).toBe(4);
  });

  it("spends only the remaining budget on the second reminder type", async () => {
    const ending = await seedTrial(new Date(Date.now() + 2.5 * DAY));
    for (let i = 0; i < 3; i++) await seedTrial(new Date(Date.now() - DAY));

    await checkTrialReminders();

    expect(send).toHaveBeenCalledTimes(2);
    expect(recipients()).toContain(ending.user.email);
    const rows = await app.db.find(BillingReminderSentEntity);
    expect(rows.map((row) => row.reminderType).sort()).toEqual([
      "trial_ending",
      "trial_expired",
    ]);
  });

  it("sends the most urgent trials first", async () => {
    const soonest = await seedTrial(new Date(Date.now() - 9 * DAY));
    await seedTrial(new Date(Date.now() - 2 * DAY));
    await seedTrial(new Date(Date.now() - 1 * DAY));

    await checkTrialReminders();

    expect(recipients()[0]).toBe(soonest.user.email);
  });

  it("emails an owner once no matter how many workspaces they have", async () => {
    const lapsed = new Date(Date.now() - DAY);
    const { user } = await seedTrial(lapsed);
    for (let i = 0; i < 19; i++) {
      await addWorkspaceOwnedBy(user.id, lapsed);
    }

    await checkTrialReminders();

    expect(send).toHaveBeenCalledTimes(1);
    expect(recipients()).toEqual([user.email]);
  });

  it("still emails every distinct owner", async () => {
    const lapsed = new Date(Date.now() - DAY);
    const a = await seedTrial(lapsed);
    const b = await seedTrial(lapsed);

    await checkTrialReminders();

    expect(recipients().sort()).toEqual([a.user.email, b.user.email].sort());
  });
});
