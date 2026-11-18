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
import type { WorkspaceBillingEntity } from "../../src/database/entities/workspace-billing.entity";
import { stubBillingEnv } from "../support/fixtures/billing-env";
import { setBilling } from "../support/fixtures/billing-rows";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const EXPIRED =
  "This workspace's Kaneo Cloud plan has expired. Subscribe to continue creating and editing.";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  stubBillingEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function ownerWithProject(billing: Partial<WorkspaceBillingEntity>) {
  const member = await createWorkspaceMember(app.db, { role: "owner" });
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  await setBilling(app.db, member.workspace.id, billing);
  app.auth.signIn(member.user);
  return { ...member, project };
}

function createTask(projectId: string) {
  return app.request(
    `/api/task/${projectId}`,
    json("POST", {
      title: "Billing gate task",
      description: "",
      priority: "low",
      status: "to-do",
    }),
  );
}

describe("API integration: billing enforcement", () => {
  it("blocks task creation with 402 when the trial has expired", async () => {
    const { project } = await ownerWithProject({
      foundingFree: false,
      trialEndsAt: new Date(Date.now() - 60_000),
    });

    const response = await createTask(project.id);

    expect(response.status).toBe(402);
    expect(await readErrorBody(response)).toMatchObject({ message: EXPIRED });
  });

  it("allows task creation during an active trial", async () => {
    const { project } = await ownerWithProject({
      foundingFree: false,
      trialEndsAt: new Date(Date.now() + 60_000),
    });

    expect((await createTask(project.id)).status).toBe(200);
  });

  it("allows task creation for founding-free workspaces", async () => {
    const { project } = await ownerWithProject({
      foundingFree: true,
      trialEndsAt: new Date(Date.now() - 60_000),
    });

    expect((await createTask(project.id)).status).toBe(200);
  });

  it("allows task creation with an active subscription", async () => {
    const { workspace, project } = await ownerWithProject({
      foundingFree: false,
      trialEndsAt: new Date(Date.now() - 60_000),
      status: "active",
      plan: "personal",
    });
    await setBilling(app.db, workspace.id, {
      creemSubscriptionId: `sub-${workspace.id}`,
    });

    expect((await createTask(project.id)).status).toBe(200);
  });

  it("allows everything on a self-hosted instance, whatever the billing row says", async () => {
    vi.unstubAllEnvs();
    const { project } = await ownerWithProject({
      foundingFree: false,
      trialEndsAt: new Date(Date.now() - 60_000),
    });

    expect((await createTask(project.id)).status).toBe(200);
  });

  it("blocks project creation with 402 once the plan has expired", async () => {
    const { workspace } = await ownerWithProject({
      trialEndsAt: new Date(Date.now() - 60_000),
    });

    const response = await app.request(
      "/api/project",
      json("POST", {
        name: "Blocked",
        workspaceId: workspace.id,
        icon: "Folder",
        slug: "BLK",
      }),
    );

    expect(response.status).toBe(402);
  });

  it("starts a trial for a workspace with no billing row yet", async () => {
    const member = await createWorkspaceMember(app.db, { role: "owner" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    app.auth.signIn(member.user);

    expect((await createTask(project.id)).status).toBe(200);
  });
});
