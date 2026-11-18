// Ported from tests/api/plugins/github/rapid-state-sync.test.ts (GitHub cases).
// The old unit test mocked the database, the link writes, `canSyncTask`,
// `dispatchIssueWrite` and `syncTaskFieldLabels`; this runs
// `handleTaskStatusChanged` with the real sync engine and database, so the
// provider double also answers the issue read and label calls.
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
import { handleTaskStatusChanged } from "../../src/integrations/github/events/task-status-changed";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { isOutboundEcho } from "../../src/integrations/links/sync-echo";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import {
  insertGitHubIntegration,
  verifiedGitHubConfig,
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
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(["closed", "open"])(
  "repairs a late github %s response using the current task state",
  async (firstState) => {
    const finalState = firstState === "closed" ? "open" : "closed";
    const statusOf = (state: string) =>
      state === "closed" ? "done" : "in-progress";
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const config = verifiedGitHubConfig();
    const integration = await insertGitHubIntegration(app.db, project.id, config);
    const task = await createTask(app.db, {
      projectId: project.id,
      status: statusOf(firstState),
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://github.com/owner/repo/issues/1",
    });
    const context = { integrationId: integration.id, projectId: project.id, config };

    const started = deferred();
    const release = deferred();
    let first = true;
    let remote = finalState;
    const write = vi.fn(async (state: string) => {
      if (first) {
        first = false;
        started.resolve();
        await release.promise;
      }
      remote = state;
      return { updated_at: `${state}-stamp` };
    });
    double.octokit.rest.issues.update.mockImplementation(
      async ({ state }: { state: string }) => ({ data: await write(state) }),
    );
    double.octokit.rest.issues.get.mockImplementation(async () => ({
      data: { number: 1, title: "Seed", body: null, state: remote, labels: [] },
    }));
    double.octokit.rest.issues.getLabel.mockResolvedValue({ data: {} });
    double.octokit.rest.issues.addLabels.mockResolvedValue({ data: [] });
    double.octokit.rest.issues.removeLabel.mockResolvedValue({ data: [] });

    const event = {
      taskId: task.id,
      projectId: project.id,
      userId: "user",
      title: task.title,
      oldStatus: statusOf(finalState),
      newStatus: statusOf(firstState),
    };
    const older = handleTaskStatusChanged(deps, event, context);
    await started.promise;
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { status: statusOf(finalState) },
    );
    await handleTaskStatusChanged(
      deps,
      { ...event, oldStatus: event.newStatus, newStatus: statusOf(finalState) },
      context,
    );
    expect(remote).toBe(finalState);
    release.resolve();
    await older;
    expect(remote).toBe(finalState);
    expect(write.mock.calls.map(([state]) => state)).toEqual([
      firstState,
      finalState,
      finalState,
    ]);
    // The old suite read the last `updateExternalLink` call: its outbound
    // record is the final state with that response's provider timestamp.
    const metadata = JSON.parse(
      (await app.db.findOneByOrFail(ExternalLinkEntity, { id: link.id }))
        .metadata!,
    );
    expect(metadata.state).toBe(finalState);
    expect(
      isOutboundEcho(metadata.lastSync.state, finalState, `${finalState}-stamp`),
    ).toBe(true);
  },
);

// The Gitea/GitLab cases are in test/integration/gitea-rapid-state-sync.test.ts.
