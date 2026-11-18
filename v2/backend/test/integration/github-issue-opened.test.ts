// Ported from tests/api/plugins/github/webhooks/issue-opened.test.ts. The old
// unit test mocked the database, the integration lookup and the link writes;
// this runs `handleIssueOpened` against the real database and the App double.
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
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { handleIssueOpened } from "../../src/integrations/github/webhooks/issue-opened";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import {
  githubWebhookSource,
  insertGitHubIntegration,
  verifiedGitHubConfig,
} from "../support/fixtures/github-fixtures";
import { resetTestDatabase } from "../support/reset-test-database";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { createTestApp, type TestApp } from "../support/test-app";

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
  vi.stubEnv("GITHUB_APP_NAME", "");
  vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
  double.octokit.rest.issues.createComment.mockResolvedValue({});
  double.octokit.rest.issues.addLabels.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
    slug: "kaneo",
  });
  const integration = await insertGitHubIntegration(
    app.db,
    project.id,
    verifiedGitHubConfig({
      commentTaskLinkOnGitHubIssue: true,
      branchPattern: "{slug}-{number}",
      statusTransitions: {
        onBranchPush: "in-progress",
        onPROpen: "in-review",
        onPRMerge: "done",
      },
    }),
  );
  return { project, integration };
}

function issueOpenedPayload(labels: Array<string | { name?: string }>) {
  return {
    action: "opened",
    issue: {
      number: 42,
      title: "Fix the login bug",
      body: "Steps to reproduce",
      html_url: "https://github.com/owner/repo/issues/42",
      labels,
      user: { login: "octocat" },
    },
    ...githubWebhookSource,
  };
}

describe("handleIssueOpened", () => {
  it("persists a valid default priority when the issue has no priority: label", async () => {
    const { project, integration } = await setup();
    await handleIssueOpened(deps, issueOpenedPayload(["type:bug"]));

    const tasks = await app.db.findBy(TaskEntity, { projectId: project.id });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).not.toBeNull();
    expect(tasks[0]!.priority).toBe("low");
    expect(
      await app.db.findBy(ExternalLinkEntity, {
        integrationId: integration.id,
        externalId: "42",
      }),
    ).toHaveLength(1);
    expect(double.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(double.octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "owner",
        repo: "repo",
        issue_number: 42,
        body: expect.stringContaining(`[KANEO-${tasks[0]!.number}]`),
      }),
    );
  });

  it("persists the extracted priority label when present", async () => {
    const { project } = await setup();
    await handleIssueOpened(
      deps,
      issueOpenedPayload(["type:bug", "priority:high"]),
    );

    const tasks = await app.db.findBy(TaskEntity, { projectId: project.id });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBe("high");
    // The issue already carries `priority:high`, so no label is added.
    expect(double.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });
});
