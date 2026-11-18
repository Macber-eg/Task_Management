// Ported from tests/api-integration/integration-push-task-ownership.test.ts (GitHub cases).
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
import { handlePush } from "../../src/integrations/github/webhooks/push";
import { TaskMoveService } from "../../src/task/mutations/task-move.service";
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
});

const races = ["new", "existing", "moved", "excluded", "paused"];

it.each(races.map((race) => ({ race })))(
  "github branch push preserves ownership and final tasks ($race)",
  async ({ race }) => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
      slug: "KAN",
    });
    const { project: destination } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      number: 1,
      title: "card",
      status: "done",
    });
    const integration = await insertGitHubIntegration(
      app.db,
      project.id,
      verifiedGitHubConfig({
        verifiedGithubAccountId: "123",
        verifiedByUserId: user.id,
        branchPattern: "{slug}-{number}",
        ...(race === "excluded"
          ? {
              syncRules: {
                outgoing: { mode: "labels", match: "any", labels: ["missing"] },
                incoming: { mode: "all" },
              },
            }
          : {}),
        statusTransitions: { onBranchPush: "in-progress" },
      }),
    );
    if (race === "paused")
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: "2",
        url: "https://git.example/owner/repo/issues/2",
        metadata: JSON.stringify({ syncFilterPaused: true }),
      });
    if (race === "existing")
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "branch",
        externalId: "KAN-1",
        url: "https://git.example/owner/repo/tree/KAN-1",
      });
    const transaction = app.db.transaction.bind(app.db);
    if (race === "moved")
      vi.spyOn(app.db, "transaction").mockImplementationOnce(
        async (...args: unknown[]) => {
          await app.get(TaskMoveService).moveTask({
            taskId: task.id,
            destinationProjectId: destination.id,
            currentUserId: user.id,
          });
          return (transaction as (...args: unknown[]) => Promise<unknown>)(
            ...args,
          );
        },
      );
    const branchLinks = () =>
      app.db.findBy(ExternalLinkEntity, {
        taskId: task.id,
        resourceType: "branch",
      });
    const publish = vi
      .spyOn(app.get(EventBus), "publish")
      .mockImplementation(async (type) => {
        if (type !== "task.updated") return;
        const [committed] = await branchLinks();
        expect(committed?.resourceType).toBe("branch");
      });

    await handlePush(deps, {
      ref: "refs/heads/KAN-1",
      after: "abc",
      installation: { id: 10 },
      repository: {
        id: 20,
        owner: { login: "owner" },
        name: "repo",
        html_url: "https://git.example/owner/repo",
      },
    });

    const saved = await app.db.findOneByOrFail(TaskEntity, { id: task.id });
    expect(saved.projectId).toBe(race === "moved" ? destination.id : project.id);
    expect(saved.status).toBe(
      ["new", "excluded", "paused"].includes(race) ? "in-progress" : "done",
    );
    expect(await branchLinks()).toHaveLength(race === "moved" ? 0 : 1);
    expect(
      publish.mock.calls.filter(([type]) => type === "task.updated"),
    ).toHaveLength(race === "moved" ? 0 : 1);
  },
);

// The Gitea/GitLab cases are in test/integration/gitea-push-task-ownership.test.ts.
