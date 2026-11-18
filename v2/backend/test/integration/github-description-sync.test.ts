// Ported from tests/api-integration/github-description-sync.test.ts.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { handleIssueEdited } from "../../src/integrations/github/webhooks/issue-edited";
import { formatIssueBody } from "../../src/integrations/links/issue-format";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import {
  githubWebhookSource,
  insertGitHubIntegration,
} from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GitHub description round trip", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;
  let deps: GitHubDeps;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
    deps = githubDepsOf(app);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    double.reset();
    vi.restoreAllMocks();
    vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
  });

  async function setup() {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const integration = await insertGitHubIntegration(app.db, project.id);
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Linked",
      description: "Original description",
      number: 1,
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://github.com/owner/repo/issues/1",
      taskId: task.id,
      metadata: JSON.stringify({
        lastSync: {
          description: {
            source: "kaneo",
            value: task.description,
            timestamp: new Date(Date.now() - 60_000).toISOString(),
          },
        },
      }),
    });
    return { task, link };
  }

  function webhook(body: string) {
    // The provider still holds the delivered body when a confirmation is read.
    double.octokit.rest.issues.get.mockResolvedValue({
      data: { number: 1, title: "Linked", body },
    });
    return handleIssueEdited(deps, {
      action: "edited",
      issue: {
        number: 1,
        title: "Linked",
        body,
        html_url: "https://github.com/owner/repo/issues/1",
      },
      changes: { body: { from: "Old body" } },
      ...githubWebhookSource,
    });
  }

  const storedTask = (id: string) =>
    app.db.findOneByOrFail(TaskEntity, { id });
  const storedLink = (id: string) =>
    app.db.findOneByOrFail(ExternalLinkEntity, { id });

  it("ignores the echoed body even after the two-second sync window", async () => {
    const { task, link } = await setup();
    await webhook(formatIssueBody(task.description, task.id));
    expect((await storedTask(task.id)).description).toBe(task.description);
    // The old suite asserted `updateExternalLink` was never called.
    expect((await storedLink(link.id)).metadata).toBe(link.metadata);
  });

  it("accepts a real GitHub edit without importing the generated footer", async () => {
    const { task, link } = await setup();
    await webhook(formatIssueBody("Edited on GitHub\n\nDetails", task.id));
    const stored = await storedTask(task.id);
    expect(stored.description).toBe("Edited on GitHub\n\nDetails");
    expect(JSON.parse((await storedLink(link.id)).metadata!)).toMatchObject({
      lastSync: {
        description: { source: "github", value: stored.description },
      },
    });
  });

  it("preserves a footer mentioning a different task", async () => {
    const { task } = await setup();
    const body = formatIssueBody("User content", "another-task");
    await webhook(body);
    expect((await storedTask(task.id)).description).toBe(body);
  });
});
