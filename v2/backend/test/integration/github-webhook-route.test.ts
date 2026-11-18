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
import { LabelEntity } from "../../src/database/entities/label.entity";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import {
  GITHUB_TEST_WEBHOOK_SECRET,
  githubWebhookHeaders,
  githubWebhookSource,
  insertGitHubIntegration,
} from "../support/fixtures/github-fixtures";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// `POST /api/github-integration/webhook` (the previous API's
// `handleGithubWebhookRoute`): public, signed over the raw body.
describe("GitHub webhook route", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    double.reset();
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", GITHUB_TEST_WEBHOOK_SECRET);
    app.auth.signOut();
  });
  afterEach(() => vi.unstubAllEnvs());

  const labelCreated = JSON.stringify({
    action: "created",
    label: { name: "From GitHub", color: "abcdef" },
    ...githubWebhookSource,
  });
  const deliver = (body: string, headers: Record<string, string>) =>
    app.request("/api/github-integration/webhook", {
      method: "POST",
      body,
      headers,
    });

  async function seed() {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    await insertGitHubIntegration(app.db, project.id);
    return workspace;
  }

  it("applies a signed delivery without a session", async () => {
    const workspace = await seed();
    const response = await deliver(
      labelCreated,
      githubWebhookHeaders("label", labelCreated),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "success" });
    expect(await app.db.find(LabelEntity)).toMatchObject([
      { workspaceId: workspace.id, name: "From GitHub", color: "#abcdef" },
    ]);
  });

  it("rejects a delivery whose signature does not match the raw body", async () => {
    await seed();
    const headers = githubWebhookHeaders("label", labelCreated);
    const response = await deliver(
      labelCreated.replace("From GitHub", "Forged"),
      headers,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("signature does not match");
    expect(await app.db.find(LabelEntity)).toHaveLength(0);
  });

  it("requires the signature and event headers", async () => {
    const { "x-hub-signature-256": _signature, ...unsigned } =
      githubWebhookHeaders("label", labelCreated);
    let response = await deliver(labelCreated, unsigned);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing signature" });

    const { "x-github-event": _event, ...unnamed } = githubWebhookHeaders(
      "label",
      labelCreated,
    );
    response = await deliver(labelCreated, unnamed);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing event name" });
  });

  it("refuses deliveries while the App is not configured", async () => {
    double.github.configured = false;
    const response = await deliver(
      labelCreated,
      githubWebhookHeaders("label", labelCreated),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "GitHub integration not configured",
    });
  });

  it("acknowledges events it has no handler for", async () => {
    const ping = JSON.stringify({ zen: "Keep it simple" });
    const response = await deliver(ping, githubWebhookHeaders("ping", ping));
    expect(response.status).toBe(200);
  });
});
