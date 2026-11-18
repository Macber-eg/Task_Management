import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GiteaImportService } from "../../src/integrations/gitea/import/gitea-import.service";
import { handleGiteaIssueOpened } from "../../src/integrations/gitea/webhooks/issue-opened";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The Gitea cases of tests/api-integration/integration-sync-imported-link.test.ts.
const mocks = vi.hoisted(() => ({ issues: vi.fn() }));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => ({
    listIssues: mocks.issues,
    listPulls: async () => [],
    listIssueComments: async () => [],
  }),
}));

let app: TestApp;
let publish: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
  mocks.issues.mockReset().mockResolvedValue([]);
  publish = vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});

const importIssues = (projectId: string) =>
  app.get(GiteaImportService).importIssues(projectId);

it("gitea manual refresh commits its final label eligibility before publishing", async () => {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const root = await insertRow(app.db, LabelEntity, {
    workspaceId: workspace.id,
    name: "export",
    color: "#123456",
  });
  const integration = await insertRow(app.db, IntegrationEntity, {
    projectId: project.id,
    type: "gitea",
    isActive: true,
    config: JSON.stringify({
      repositoryOwner: "team",
      repositoryName: "repo",
      baseUrl: "https://git.example",
      projectPath: "team/repo",
      accessToken: "fake-test-token",
      syncRules: {
        outgoing: { mode: "labels", match: "any", labels: [root.id] },
        incoming: { mode: "all" },
      },
    }),
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "Existing task",
    number: 1,
  });
  await insertRow(app.db, LabelEntity, {
    workspaceId: workspace.id,
    taskId: task.id,
    name: root.name,
    color: root.color,
  });
  const link = await insertRow(app.db, ExternalLinkEntity, {
    taskId: task.id,
    integrationId: integration.id,
    resourceType: "issue",
    externalId: "9",
    metadata: "{}",
    url: "https://git.example/team/repo/issues/9",
  });
  mocks.issues.mockResolvedValue([
    {
      number: 9,
      title: "Updated issue",
      body: "Body",
      state: "open",
      html_url: link.url,
      labels: [{ id: 2, name: "other", color: "123456" }],
    },
  ]);
  const pausedAtPublish: boolean[] = [];
  publish.mockImplementation(async () => {
    const stored = await app.db.findOne(ExternalLinkEntity, {
      where: { id: link.id },
    });
    pausedAtPublish.push(
      JSON.parse(stored!.metadata!).syncFilterPaused === true,
    );
  });
  expect(await importIssues(project.id)).toMatchObject({ updated: 1 });
  // Gitea's refresh replaces the task's labels with the issue's, so the
  // qualifying label is gone (and the link paused) before anything publishes.
  expect(pausedAtPublish).toEqual([true, true, true]);
  const labels = await app.db.find(LabelEntity, { where: { taskId: task.id } });
  expect(labels.map((label) => label.name)).not.toContain("export");
  expect(
    await app.db.findOne(TaskEntity, { where: { id: task.id } }),
  ).toMatchObject({ title: "Updated issue" });
});

it.each(
  [true, false].flatMap((qualifying) =>
    ["webhook", "manual"].map((source) => ({ qualifying, source })),
  ),
)(
  "gitea $source imports links with their committed outgoing scope (qualifying=$qualifying)",
  async ({ qualifying, source }) => {
    const { workspace, user } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const label = await insertRow(app.db, LabelEntity, {
      workspaceId: workspace.id,
      name: "export",
      color: "red",
    });
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "gitea",
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
    const labels = qualifying ? ["export"] : ["other"];
    const url = "https://git.example/team/repo/issues/9";
    if (source === "manual") {
      mocks.issues.mockResolvedValue([
        {
          number: 9,
          title: "Imported issue",
          body: "Body",
          html_url: url,
          state: "open",
          labels: labels.map((name, id) => ({ id, name, color: "ff0000" })),
          user: { login: "author" },
        },
      ]);
      expect(await importIssues(project.id)).toMatchObject({ imported: 1 });
    } else
      await handleGiteaIssueOpened(
        app.db,
        app.get(EventBus),
        {
          action: "opened",
          issue: {
            number: 9,
            title: "Imported issue",
            body: "Body",
            html_url: url,
            labels: labels.map((name) => ({ name, color: "1a2b3c" })),
            user: { login: "author" },
          },
          repository: {
            owner: { login: "team" },
            name: "repo",
            html_url: "https://git.example/team/repo",
          },
        },
        integration.id,
      );
    const link = (await app.db.find(ExternalLinkEntity))[0]!;
    expect(link).toBeDefined();
    expect(JSON.parse(link.metadata!).syncFilterPaused === true).toBe(
      !qualifying,
    );
    const assigned = await app.db.findOne(LabelEntity, {
      where: { taskId: link.taskId },
    });
    expect(assigned?.color).toBe(
      qualifying ? label.color : source === "manual" ? "#ff0000" : "#1a2b3c",
    );
    if (!qualifying) {
      await insertRow(app.db, LabelEntity, {
        taskId: link.taskId,
        workspaceId: workspace.id,
        name: label.name,
        color: label.color,
      });
      expect(await canSyncTask(app.db, link.taskId, integration.id)).toBe(
        false,
      );
      expect(
        await app.db.findOne(ExternalLinkEntity, { where: { id: link.id } }),
      ).toMatchObject({ id: link.id, integrationId: integration.id });
    }
  },
);
