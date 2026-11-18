// Ported from tests/api/plugins/github/rapid-text-sync.test.ts (GitHub cases).
// The old unit test mocked the database, the link lookups and writes,
// `canSyncTask` and `dispatchIssueWrite`; this runs the title and description
// handlers with the real sync engine and database against the App double.
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
import { handleTaskDescriptionChanged } from "../../src/integrations/github/events/task-description-changed";
import { handleTaskTitleChanged } from "../../src/integrations/github/events/task-title-changed";
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
  double.octokit.rest.issues.update.mockResolvedValue({
    data: { updated_at: "provider-time" },
  });
});

/** A task holding `current`, linked to issue #1 whose `field` was last synced from `source`. */
async function setup(
  current: { title?: string; description?: string },
  field: string,
  source: string,
  value: string,
) {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const config = verifiedGitHubConfig();
  const integration = await insertGitHubIntegration(app.db, project.id, config);
  const task = await createTask(app.db, { projectId: project.id, ...current });
  const link = await insertRow(app.db, ExternalLinkEntity, {
    integrationId: integration.id,
    taskId: task.id,
    resourceType: "issue",
    externalId: "1",
    url: "https://github.com/owner/repo/issues/1",
    metadata: JSON.stringify({
      lastSync: {
        [field]: { source, value, timestamp: new Date().toISOString() },
      },
    }),
  });
  const context = {
    integrationId: integration.id,
    projectId: project.id,
    config,
  };
  return { task, link, context };
}

const update = () => double.octokit.rest.issues.update;

describe("rapid github text edits", () => {
  it("sends a second local title even immediately after the first sync", async () => {
    const { task, context } = await setup(
      { title: "Second title" },
      "title",
      "kaneo",
      "First title",
    );
    await handleTaskTitleChanged(
      deps,
      {
        taskId: task.id,
        projectId: context.projectId,
        userId: "user",
        oldTitle: "First title",
        newTitle: "Second title",
      },
      context,
    );
    expect(update()).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Second title" }),
    );
  });

  it("sends a different title immediately after an incoming github title", async () => {
    const { task, context } = await setup(
      { title: "Local correction" },
      "title",
      "github",
      "Remote title",
    );
    await handleTaskTitleChanged(
      deps,
      {
        taskId: task.id,
        projectId: context.projectId,
        userId: "user",
        oldTitle: "Remote title",
        newTitle: "Local correction",
      },
      context,
    );
    expect(update()).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Local correction" }),
    );
  });

  it("keeps suppressing an exact incoming echo", async () => {
    const { task, context } = await setup(
      { title: "Remote title" },
      "title",
      "github",
      "Remote title",
    );
    await handleTaskTitleChanged(
      deps,
      {
        taskId: task.id,
        projectId: context.projectId,
        userId: "user",
        oldTitle: "Old",
        newTitle: "Remote title",
      },
      context,
    );
    expect(update()).not.toHaveBeenCalled();
  });

  it("sends a second local description immediately after the first sync", async () => {
    const { task, context } = await setup(
      { description: "Second description" },
      "description",
      "kaneo",
      "First description",
    );
    await handleTaskDescriptionChanged(
      deps,
      {
        taskId: task.id,
        projectId: context.projectId,
        userId: "user",
        oldDescription: "First description",
        newDescription: "Second description",
      },
      context,
    );
    expect(update()).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Second description"),
      }),
    );
  });
});

it("does not send a queued title after a newer task edit", async () => {
  const { task, context } = await setup(
    { title: "Newest" },
    "title",
    "kaneo",
    "Old",
  );
  await handleTaskTitleChanged(
    deps,
    {
      taskId: task.id,
      projectId: context.projectId,
      userId: "user",
      oldTitle: "Old",
      newTitle: "Queued",
    },
    context,
  );
  expect(update()).not.toHaveBeenCalled();
});

it.each(["title", "description"])(
  "repairs github %s when an older request completes after the latest edit",
  async (field) => {
    let finishOld!: () => void;
    let oldStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    const delayed = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    let remote = "";
    const { task, link, context } = await setup(
      { title: "A", description: "A" },
      field,
      "kaneo",
      "Before",
    );
    update().mockImplementation(
      async (input: { title?: string; body?: string }) => {
        const value =
          field === "title" ? input.title! : input.body!.split("\n\n---")[0]!;
        if (value === "A") {
          oldStarted();
          await delayed;
        }
        remote = value;
        return {
          updated_at: "provider-time",
          data: { updated_at: "provider-time" },
        };
      },
    );
    double.octokit.rest.issues.get.mockImplementation(async () => ({
      data: { title: remote, body: remote, state: "open", labels: [] },
    }));
    const handler =
      field === "title" ? handleTaskTitleChanged : handleTaskDescriptionChanged;
    function event(value: string) {
      return {
        taskId: task.id,
        projectId: context.projectId,
        userId: "user",
        oldTitle: "Before",
        newTitle: value,
        oldDescription: "Before",
        newDescription: value,
      };
    }
    const first = handler(deps, event("A"), context);
    await started;
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { title: "B", description: "B" },
    );
    await handler(deps, event("B"), context);
    expect(remote).toBe("B");
    finishOld();
    await first;
    expect(remote).toBe("B");
    expect(update()).toHaveBeenCalledTimes(3);
    // The old suite read the last `updateExternalLink` call's outbound value.
    const saved = await app.db.findOneByOrFail(ExternalLinkEntity, {
      id: link.id,
    });
    const stamp = JSON.parse(saved.metadata!).lastSync[field];
    expect(stamp.outbound.at(-1)).toMatchObject({ updatedAt: "provider-time" });
    expect(isOutboundEcho(stamp, "B", "provider-time")).toBe(true);
    if (field === "title") expect(saved.title).toBe("B");
  },
);

// The Gitea/GitLab cases are in test/integration/gitea-rapid-text-sync.test.ts.
