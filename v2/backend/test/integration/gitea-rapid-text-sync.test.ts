// The Gitea cases of tests/api/plugins/github/rapid-text-sync.test.ts, run
// against the real sync engine and database with a Gitea client double.
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
  remote: "",
  update: vi.fn<(input: { title?: string; body?: string }) => Promise<unknown>>(),
}));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => ({
    getIssue: async () => ({
      title: m.remote,
      body: m.remote,
      state: "open",
      labels: [],
    }),
    updateIssue: async (
      _owner: string,
      _repo: string,
      _number: number,
      input: { title?: string; body?: string },
    ) => m.update(input),
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
  m.update.mockReset();
  m.remote = "";
  vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});

it.each(["title", "description"])(
  "repairs gitea %s when an older request completes after the latest edit",
  async (field) => {
    let finishOld!: () => void;
    let oldStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    const delayed = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
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
      title: "A",
      description: "A",
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      integrationId: integration.id,
      taskId: task.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://gitea.example/owner/repo/issues/1",
      metadata: JSON.stringify({
        lastSync: {
          [field]: {
            source: "kaneo",
            value: "Before",
            timestamp: new Date().toISOString(),
          },
        },
      }),
    });
    const context = {
      integrationId: integration.id,
      projectId: project.id,
      config,
    };
    m.update.mockImplementation(async (input) => {
      const value =
        field === "title" ? input.title! : input.body!.split("\n\n---")[0]!;
      if (value === "A") {
        oldStarted();
        await delayed;
      }
      m.remote = value;
      return { updated_at: "provider-time" };
    });
    const plugin = app.get(GiteaPlugin);
    const send = (value: string) =>
      field === "title"
        ? plugin.onTaskTitleChanged(
            {
              taskId: task.id,
              projectId: project.id,
              userId: "user",
              oldTitle: "Before",
              newTitle: value,
            },
            context,
          )
        : plugin.onTaskDescriptionChanged(
            {
              taskId: task.id,
              projectId: project.id,
              userId: "user",
              oldDescription: "Before",
              newDescription: value,
            },
            context,
          );
    const first = send("A");
    await started;
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { title: "B", description: "B" },
    );
    await send("B");
    expect(m.remote).toBe("B");
    finishOld();
    await first;
    expect(m.remote).toBe("B");
    expect(m.update).toHaveBeenCalledTimes(3);
    const saved = await app.db.findOneByOrFail(ExternalLinkEntity, {
      id: link.id,
    });
    const stamp = JSON.parse(saved.metadata!).lastSync[field];
    expect(stamp.outbound.at(-1)).toMatchObject({ updatedAt: "provider-time" });
    expect(isOutboundEcho(stamp, "B", "provider-time")).toBe(true);
    if (field === "title") expect(saved.title).toBe("B");
  },
);
