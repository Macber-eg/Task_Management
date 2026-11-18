// Ported from tests/api-integration/integration-sync-task-moved.test.ts
// (GitHub cases; the Gitea/GitLab ones are in gitea-sync-task-moved.test.ts). The move runs
// through `TaskMoveService`, whose `task.moved` event reaches the reconciler
// and the real GitHub plugin.
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
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { SyncReconciler } from "../../src/integrations/sync/sync-reconciler";
import { TaskMoveService } from "../../src/task/mutations/task-move.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GitHub sync of moved tasks", () => {
  const double = createGitHubAppDouble();
  const { octokit } = double;
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    double.reset();
    const issue = {
      number: 12,
      html_url: "https://git.example/team/repo/issues/12",
      title: "Moved task",
      state: "open",
      body: "",
      labels: [],
    };
    octokit.rest.issues.create.mockResolvedValue({ data: issue });
    octokit.rest.issues.get.mockResolvedValue({ data: issue });
    octokit.rest.issues.update.mockResolvedValue({ data: issue });
    octokit.rest.issues.getLabel.mockResolvedValue({});
    octokit.rest.issues.addLabels.mockResolvedValue(undefined);
  });

  it.each([true, false])(
    "github reconciles moved tasks in the destination project (qualifying=%s)",
    async (qualifying) => {
      const { workspace, user } = await createWorkspaceMember(app.db);
      const source = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });
      const destination = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });
      const label = await insertRow(app.db, LabelEntity, {
        workspaceId: workspace.id,
        name: "export",
        color: "#123456",
      });
      const integration = await insertRow(app.db, IntegrationEntity, {
        projectId: destination.project.id,
        type: "github",
        isActive: true,
        config: JSON.stringify({
          repositoryOwner: "team",
          repositoryName: "repo",
          repositoryId: 1,
          installationId: 2,
          verifiedGithubAccountId: "3",
          verifiedByUserId: user.id,
          baseUrl: "https://git.example",
          projectPath: "team/repo",
          accessToken: "fake-test-token",
          commentTaskLinkOnGitHubIssue: false,
          commentTaskLinkOnGiteaIssue: false,
          commentTaskLinkOnGitlabIssue: false,
          syncRules: {
            outgoing: { mode: "labels", match: "any", labels: [label.id] },
            incoming: { mode: "all" },
          },
        }),
      });
      const task = await createTask(app.db, {
        projectId: source.project.id,
        title: "Moved task",
        number: 1,
        status: "to-do",
        columnId: source.columns.todo.id,
      });
      if (qualifying)
        await insertRow(app.db, LabelEntity, {
          workspaceId: workspace.id,
          taskId: task.id,
          name: "export",
          color: "#123456",
        });
      let completed!: () => void;
      const reconciled = new Promise<void>((resolve) => {
        completed = resolve;
      });
      const reconciler = app.get(SyncReconciler);
      const original = reconciler.reconcileTaskSync.bind(reconciler);
      const handler = vi
        .spyOn(reconciler, "reconcileTaskSync")
        .mockImplementationOnce(async (...args) => {
          try {
            await original(...args);
          } finally {
            completed();
          }
        });
      await app.get(TaskMoveService).moveTask({
        taskId: task.id,
        destinationProjectId: destination.project.id,
        currentUserId: user.id,
      });
      await reconciled;
      expect(handler).toHaveBeenCalledWith(destination.project.id, task.id);
      expect(octokit.rest.issues.create).toHaveBeenCalledTimes(
        qualifying ? 1 : 0,
      );
      const links = await app.db.find(ExternalLinkEntity);
      expect(links).toHaveLength(qualifying ? 1 : 0);
      if (qualifying)
        expect(links[0]).toMatchObject({
          taskId: task.id,
          integrationId: integration.id,
          resourceType: "issue",
          externalId: "12",
        });
    },
  );

  // The Gitea/GitLab cases are in test/integration/gitea-sync-task-moved.test.ts.
});
