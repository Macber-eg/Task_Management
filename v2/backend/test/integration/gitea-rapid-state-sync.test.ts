// The Gitea cases of tests/api/plugins/github/rapid-state-sync.test.ts. As in
// the GitHub port, `handleTaskStatusChanged` runs with the real sync engine and
// database; the Gitea client double also answers the issue read and labels.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GiteaPlugin } from "../../src/integrations/gitea/gitea.plugin";
import { isOutboundEcho } from "../../src/integrations/links/sync-echo";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const m = vi.hoisted(() => ({
  remote: "open",
  write: vi.fn<(state: string) => Promise<{ updated_at: string }>>(),
}));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => ({
    getIssue: async () => ({
      number: 1,
      title: "Seed",
      body: null,
      state: m.remote,
      labels: [],
    }),
    updateIssue: async (
      _owner: string,
      _repo: string,
      _number: number,
      { state }: { state: string },
    ) => m.write(state),
    listLabels: async () => [],
    createLabel: async (
      _owner: string,
      _repo: string,
      name: string,
    ) => ({ id: 1, name }),
    addLabelsToIssue: async () => undefined,
    removeLabelFromIssue: async () => undefined,
  }),
}));

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
  m.write.mockReset();
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
  "repairs a late gitea %s response using the current task state",
  async (firstState) => {
    const finalState = firstState === "closed" ? "open" : "closed";
    const statusOf = (state: string) =>
      state === "closed" ? "done" : "in-progress";
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const config = {
      repositoryOwner: "owner",
      repositoryName: "repo",
      baseUrl: "https://gitea.example",
      accessToken: "test",
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "gitea",
      isActive: true,
      config: JSON.stringify(config),
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      status: statusOf(firstState),
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://gitea.example/owner/repo/issues/1",
    });
    const context = {
      integrationId: integration.id,
      projectId: project.id,
      config,
    };

    const started = deferred();
    const release = deferred();
    let first = true;
    m.remote = finalState;
    m.write.mockImplementation(async (state: string) => {
      if (first) {
        first = false;
        started.resolve();
        await release.promise;
      }
      m.remote = state;
      return { updated_at: `${state}-stamp` };
    });

    const plugin = app.get(GiteaPlugin);
    const event = {
      taskId: task.id,
      projectId: project.id,
      userId: "user",
      title: task.title,
      oldStatus: statusOf(finalState),
      newStatus: statusOf(firstState),
    };
    const older = plugin.onTaskStatusChanged(event, context);
    await started.promise;
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { status: statusOf(finalState) },
    );
    await plugin.onTaskStatusChanged(
      { ...event, oldStatus: event.newStatus, newStatus: statusOf(finalState) },
      context,
    );
    expect(m.remote).toBe(finalState);
    release.resolve();
    await older;
    expect(m.remote).toBe(finalState);
    expect(m.write.mock.calls.map(([state]) => state)).toEqual([
      firstState,
      finalState,
      finalState,
    ]);
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
