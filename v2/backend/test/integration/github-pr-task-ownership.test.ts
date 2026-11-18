// Ported from tests/api-integration/integration-pr-task-ownership.test.ts (GitHub cases).
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { handlePullRequestClosed } from "../../src/integrations/github/webhooks/pull-request-closed";
import { handlePullRequestOpened } from "../../src/integrations/github/webhooks/pull-request-opened";
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

type Case = {
  action: string;
  race: string;
  sameStatus: boolean;
  syncScope: string;
};
const cases: Case[] = ["opened", "merged"].flatMap((action) =>
  ["ordinary", "moved", "returned"].map((race) => ({
    action,
    race,
    sameStatus: false,
    syncScope: "all",
  })),
);
cases.push(
  ...["opened", "merged", "closed"].map((action) => ({
    action,
    race: "ordinary",
    sameStatus: action !== "closed",
    syncScope: "all",
  })),
);
cases.push(
  ...["opened", "merged", "closed"].flatMap((action) =>
    ["excluded", "paused"].map((syncScope) => ({
      action,
      race: "ordinary",
      sameStatus: false,
      syncScope,
    })),
  ),
);

it.each(cases)(
  "github $action webhook respects task ownership ($race, $syncScope issue sync)",
  async ({ action, race, sameStatus, syncScope }) => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
      slug: "KAN",
    });
    const { project: destination } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    await app.db.update(ProjectEntity, { id: project.id }, { lastTaskNumber: 1 });
    const task = await createTask(app.db, {
      projectId: project.id,
      number: 1,
      title: "card",
      status: sameStatus
        ? action === "opened"
          ? "in-progress"
          : "done"
        : "to-do",
      position: 0,
    });
    const integration = await insertGitHubIntegration(
      app.db,
      project.id,
      verifiedGitHubConfig({
        verifiedGithubAccountId: "123",
        verifiedByUserId: user.id,
        branchPattern: "{slug}-{number}",
        ...(syncScope === "excluded"
          ? {
              syncRules: {
                outgoing: { mode: "labels", match: "any", labels: ["missing"] },
                incoming: { mode: "all" },
              },
            }
          : {}),
        statusTransitions: { onPROpen: "in-progress", onPRMerge: "done" },
      }),
    );
    if (syncScope === "paused")
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: "2",
        url: "https://git.example/owner/repo/issues/2",
        metadata: JSON.stringify({ syncFilterPaused: true }),
      });
    if (action !== "opened")
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "pull_request",
        externalId: "1",
        url: "https://git.example/owner/repo/pull/1",
        metadata: JSON.stringify({ state: "open" }),
      });
    const request = {
      action: action === "opened" ? "opened" : "closed",
      installation: { id: 10 },
      repository: {
        id: 20,
        owner: { login: "owner" },
        name: "repo",
        html_url: "https://git.example/owner/repo",
      },
      pull_request: {
        number: 1,
        title: "change",
        body: null,
        html_url: "https://git.example/owner/repo/pull/1",
        state: action === "opened" ? "open" : "closed",
        draft: false,
        merged: action === "merged",
        merged_at: action === "merged" ? new Date().toISOString() : null,
        head: { ref: "KAN-1" },
        user: { login: "author" },
      },
    };
    const pullRequestLinks = () =>
      app.db.findBy(ExternalLinkEntity, {
        taskId: task.id,
        resourceType: "pull_request",
      });
    const publish = vi
      .spyOn(app.get(EventBus), "publish")
      .mockImplementation(async (type) => {
        if (type !== "task.updated") return;
        const [committed] = await pullRequestLinks();
        expect(committed).toBeDefined();
        expect(JSON.parse(committed!.metadata!).state).toBe(
          action === "opened" ? "open" : "closed",
        );
      });
    const moves = app.get(TaskMoveService);
    const transaction = app.db.transaction.bind(app.db);
    if (race !== "ordinary")
      vi.spyOn(app.db, "transaction").mockImplementationOnce(
        async (...args: unknown[]) => {
          await moves.moveTask({
            taskId: task.id,
            destinationProjectId: destination.id,
            currentUserId: user.id,
          });
          if (race === "returned")
            await moves.moveTask({
              taskId: task.id,
              destinationProjectId: project.id,
              currentUserId: user.id,
            });
          return (transaction as (...args: unknown[]) => Promise<unknown>)(
            ...args,
          );
        },
      );

    if (action === "opened") await handlePullRequestOpened(deps, request);
    else await handlePullRequestClosed(deps, request);

    const saved = await app.db.findOneByOrFail(TaskEntity, { id: task.id });
    expect(saved.status).toBe(
      race === "ordinary"
        ? action === "opened"
          ? "in-progress"
          : action === "merged"
            ? "done"
            : "to-do"
        : "to-do",
    );
    expect(saved.projectId).toBe(race === "moved" ? destination.id : project.id);
    expect(await pullRequestLinks()).toHaveLength(race === "ordinary" ? 1 : 0);
    expect(
      publish.mock.calls.filter(([type]) => type === "task.updated"),
    ).toEqual(
      race === "ordinary"
        ? [["task.updated", { projectId: project.id, taskId: task.id }]]
        : [],
    );
  },
);

// The Gitea/GitLab cases are in test/integration/gitea-pr-task-ownership.test.ts.
