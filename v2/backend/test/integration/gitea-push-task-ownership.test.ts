// The Gitea and GitLab cases of
// tests/api-integration/integration-push-task-ownership.test.ts (the GitHub
// cases are in github-push-task-ownership.test.ts).
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { handleGiteaPush } from "../../src/integrations/gitea/webhooks/push";
import { handleGitlabPush } from "../../src/integrations/gitlab/webhooks/push";
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

const races = ["new", "existing", "moved", "excluded", "paused"];

it.each(
  ["gitea", "gitlab"].flatMap((provider) =>
    races.map((race) => ({ provider, race })),
  ),
)(
  "$provider branch push preserves ownership and final tasks ($race)",
  async ({ provider, race }) => {
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
    });
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
    const events = app.get(EventBus);
    const publish = vi
      .spyOn(events, "publish")
      .mockImplementation(async (type) => {
        if (type !== "task.updated") return;
        const [committed] = await branchLinks();
        expect(committed?.resourceType).toBe("branch");
      });

    if (provider === "gitea")
      await handleGiteaPush(
        app.db,
        events,
        {
          ref: "refs/heads/KAN-1",
          after: "abc",
          repository: {
            owner: { login: "owner" },
            name: "repo",
            html_url: "https://git.example/owner/repo",
          },
        },
        integration.id,
      );
    else
      await handleGitlabPush(
        app.db,
        events,
        {
          ref: "refs/heads/KAN-1",
          after: "abc",
          project: {
            name: "repo",
            path_with_namespace: "owner/repo",
            web_url: "https://git.example/owner/repo",
          },
        },
        integration.id,
      );

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
