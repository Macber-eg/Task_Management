// Ported from tests/api/plugins/github/issue-reopened.test.ts. The old unit test
// mocked the database, the integration lookup, `updateTaskStatus` and
// `updateExternalLink`; this runs the reopen through `handleIssueStateChanged`
// against the real database, asserting the stored link metadata and task status
// instead of the mocked calls.
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { handleIssueStateChanged } from "../../src/integrations/github/webhooks/issue-state-changed";
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const payload = {
  action: "reopened",
  ...githubWebhookSource,
  issue: {
    number: 1,
    title: "Issue",
    html_url: "https://github.com/owner/repo/issues/1",
    state: "open",
  },
};

/**
 * One closed task per metadata, each linked to issue #1 through the
 * integration of its own project (one GitHub integration per project).
 */
async function setup(metadata: string[]) {
  const { workspace } = await createWorkspaceMember(app.db);
  const rows = [];
  for (const value of metadata) {
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const integration = await insertGitHubIntegration(app.db, project.id);
    const task = await createTask(app.db, {
      projectId: project.id,
      status: "done",
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: payload.issue.html_url,
      metadata: value,
    });
    rows.push({ task, link });
  }
  return rows;
}

const storedTask = (id: string) => app.db.findOneByOrFail(TaskEntity, { id });
const storedLink = (id: string) =>
  app.db.findOneByOrFail(ExternalLinkEntity, { id });

it.each(["null", "[]", "42", '"text"', "invalid JSON"])(
  "continues through all linked rows when metadata is %s",
  async (metadata) => {
    const [first, second] = await setup([metadata, '{"custom":"keep"}']);
    await handleIssueStateChanged(deps, payload, "open");
    expect(JSON.parse((await storedLink(first!.link.id)).metadata!)).toEqual(
      expect.objectContaining({ state: "open" }),
    );
    expect(JSON.parse((await storedLink(second!.link.id)).metadata!)).toEqual(
      expect.objectContaining({ custom: "keep", state: "open" }),
    );
    // Both linked tasks were moved by the reopen.
    expect((await storedTask(first!.task.id)).status).toBe("to-do");
    expect((await storedTask(second!.task.id)).status).toBe("to-do");
    expect(double.octokit.rest.issues.get).not.toHaveBeenCalled();
  },
);

it("retains the Kaneo-origin skip rule for valid metadata", async () => {
  const [row] = await setup(['{"createdFrom":"kaneo"}']);
  await handleIssueStateChanged(deps, payload, "open");
  expect((await storedLink(row!.link.id)).metadata).toBe(
    '{"createdFrom":"kaneo"}',
  );
  expect((await storedTask(row!.task.id)).status).toBe("done");
});

it("skips a reopen that Kaneo already applied", async () => {
  const [row] = await setup(['{"state":"open"}']);
  await handleIssueStateChanged(deps, payload, "open");
  expect((await storedLink(row!.link.id)).metadata).toBe('{"state":"open"}');
  expect((await storedTask(row!.task.id)).status).toBe("done");
});
