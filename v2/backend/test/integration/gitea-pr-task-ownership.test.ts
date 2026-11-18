// The Gitea and GitLab cases of
// tests/api-integration/integration-pr-task-ownership.test.ts (the GitHub
// cases are in github-pr-task-ownership.test.ts).
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { handleGiteaPullRequestClosed } from "../../src/integrations/gitea/webhooks/pull-request-closed";
import { handleGiteaPullRequestOpened } from "../../src/integrations/gitea/webhooks/pull-request-opened";
import { handleGitlabMergeRequestClosed } from "../../src/integrations/gitlab/webhooks/merge-request-closed";
import { handleGitlabMergeRequestOpened } from "../../src/integrations/gitlab/webhooks/merge-request-opened";
import { TaskMoveService } from "../../src/task/mutations/task-move.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
});

type Case = {
  provider: string;
  action: string;
  race: string;
  sameStatus: boolean;
  syncScope: string;
};
const providers = ["gitea", "gitlab"];
const cases: Case[] = providers.flatMap((provider) =>
  ["opened", "merged"].flatMap((action) =>
    ["ordinary", "moved", "returned"].map((race) => ({
      provider,
      action,
      race,
      sameStatus: false,
      syncScope: "all",
    })),
  ),
);
cases.push(
  ...providers.flatMap((provider) =>
    ["opened", "merged", "closed"].map((action) => ({
      provider,
      action,
      race: "ordinary",
      sameStatus: action !== "closed",
      syncScope: "all",
    })),
  ),
);
cases.push(
  ...providers.flatMap((provider) =>
    ["opened", "merged", "closed"].flatMap((action) =>
      ["excluded", "paused"].map((syncScope) => ({
        provider,
        action,
        race: "ordinary",
        sameStatus: false,
        syncScope,
      })),
    ),
  ),
);

it.each(cases)(
  "$provider $action webhook respects task ownership ($race, $syncScope issue sync)",
  async ({ provider, action, race, sameStatus, syncScope }) => {
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
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: provider,
      config: JSON.stringify({
        baseUrl: "https://git.example",
        accessToken: "test-only",
        repositoryOwner: "owner",
        repositoryName: "repo",
        projectPath: "owner/repo",
        installationId: 10,
        repositoryId: 20,
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
    });
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
        metadata: JSON.stringify({
          state: provider === "gitlab" ? "opened" : "open",
        }),
      });
    const request = {
      action: action === "opened" ? "opened" : "closed",
      repository: {
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
    const mergeRequest = {
      project: {
        name: "repo",
        path_with_namespace: "owner/repo",
        web_url: "https://git.example/owner/repo",
      },
      object_attributes: {
        iid: 1,
        title: "change",
        description: null,
        url: "https://git.example/owner/repo/-/merge_requests/1",
        state:
          action === "opened"
            ? "opened"
            : action === "merged"
              ? "merged"
              : "closed",
        action:
          action === "opened"
            ? "open"
            : action === "merged"
              ? "merge"
              : "close",
        source_branch: "KAN-1",
        draft: false,
      },
    };
    const pullRequestLinks = () =>
      app.db.findBy(ExternalLinkEntity, {
        taskId: task.id,
        resourceType: "pull_request",
      });
    const events = app.get(EventBus);
    const publish = vi
      .spyOn(events, "publish")
      .mockImplementation(async (type) => {
        if (type !== "task.updated") return;
        const [committed] = await pullRequestLinks();
        expect(committed).toBeDefined();
        expect(JSON.parse(committed!.metadata!).state).toBe(
          action === "opened"
            ? provider === "gitlab"
              ? "opened"
              : "open"
            : action === "merged" && provider === "gitlab"
              ? "merged"
              : "closed",
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

    if (provider === "gitea") {
      if (action === "opened")
        await handleGiteaPullRequestOpened(app.db, events, request, integration.id);
      else
        await handleGiteaPullRequestClosed(
          app.db,
          events,
          { ...request, pull_request: { ...request.pull_request } },
          integration.id,
        );
    } else if (action === "opened")
      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest,
        integration.id,
      );
    else
      await handleGitlabMergeRequestClosed(
        app.db,
        events,
        mergeRequest,
        integration.id,
      );

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
