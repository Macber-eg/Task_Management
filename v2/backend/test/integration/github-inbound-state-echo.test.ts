// Ported from tests/api-integration/inbound-state-echo.test.ts.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { GITHUB_DEPS, type GitHubDeps } from "../../src/integrations/github/github-deps";
import { handleIssueStateChanged } from "../../src/integrations/github/webhooks/issue-state-changed";
import { outboundStamp } from "../../src/integrations/links/sync-echo";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import {
  githubWebhookSource,
  insertGitHubIntegration,
  verifiedGitHubConfig,
} from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const double = createGitHubAppDouble();
let app: TestApp;
let deps: GitHubDeps;
let state = "open";

beforeAll(async () => {
  app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  deps = app.get<GitHubDeps>(GITHUB_DEPS as never);
  vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  double.reset();
  double.octokit.rest.issues.get.mockImplementation(async () => ({
    data: { state },
  }));
});

it.each(["closed", "open"] as const)(
  "github ignores a delayed %s state echo and accepts a later genuine edit",
  async (delayed) => {
    const current = delayed === "closed" ? "open" : "closed";
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      number: 1,
      title: "card",
      status: current === "closed" ? "done" : "to-do",
    });
    const integration = await insertGitHubIntegration(
      app.db,
      project.id,
      verifiedGitHubConfig({
        baseUrl: "https://git.example",
        accessToken: "test-only",
      }),
    );
    state = current;
    const stamp = outboundStamp(
      outboundStamp(undefined, delayed, "2026-09-30T00:00:01Z"),
      current,
      "2026-09-30T00:00:02Z",
    );
    await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://git.example/owner/repo/issues/1",
      metadata: JSON.stringify({
        createdFrom: "github",
        state: current,
        lastSync: { state: stamp },
      }),
    });
    const payload = {
      ...githubWebhookSource,
      action: delayed === "closed" ? "closed" : "reopened",
      issue: {
        number: 1,
        title: "card",
        html_url: "https://git.example/owner/repo/issues/1",
        state: delayed,
        updated_at: "2026-09-30T00:00:01Z",
      },
    };
    const apply = () => handleIssueStateChanged(deps, payload, delayed);
    const status = async () =>
      (await app.db.findOneBy(TaskEntity, { id: task.id }))?.status;

    await apply();
    expect(await status()).toBe(current === "closed" ? "done" : "to-do");

    state = delayed;
    payload.issue.updated_at = "2026-09-30T00:00:03Z";
    await apply();
    expect(await status()).toBe(delayed === "closed" ? "done" : "to-do");
  },
);

// The Gitea/GitLab cases are in test/integration/gitea-inbound-state-echo.test.ts.
