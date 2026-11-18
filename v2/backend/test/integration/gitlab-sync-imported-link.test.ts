import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitlabImportService } from "../../src/integrations/gitlab/import/gitlab-import.service";
import { handleGitlabIssueOpened } from "../../src/integrations/gitlab/webhooks/issue-opened";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The GitLab cases of tests/api-integration/integration-sync-imported-link.test.ts.
const mocks = vi.hoisted(() => ({ issues: vi.fn() }));
vi.mock("../../src/integrations/gitlab/client/gitlab-client", () => ({
  createGitlabClient: () => ({
    listIssues: mocks.issues,
    listMergeRequests: async () => [],
    listIssueNotes: async () => [],
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
  app.get(GitlabImportService).importIssues(projectId);

it("gitlab manual refresh commits its final label eligibility before publishing", async () => {
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
    type: "gitlab",
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
      iid: 9,
      title: "Updated issue",
      description: "Body",
      state: "opened",
      web_url: link.url,
      labels: ["other"],
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
  expect(pausedAtPublish).toEqual([false, false, false]);
  const labels = await app.db.find(LabelEntity, { where: { taskId: task.id } });
  expect(labels.map((label) => label.name)).toContain("export");
  expect(
    await app.db.findOne(TaskEntity, { where: { id: task.id } }),
  ).toMatchObject({ title: "Updated issue" });
});

it.each(
  [true, false].flatMap((qualifying) =>
    ["webhook", "manual"].map((source) => ({ qualifying, source })),
  ),
)(
  "gitlab $source imports links with their committed outgoing scope (qualifying=$qualifying)",
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
      type: "gitlab",
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
          iid: 9,
          title: "Imported issue",
          description: "Body",
          web_url: url,
          state: "opened",
          labels,
        },
      ]);
      expect(await importIssues(project.id)).toMatchObject({ imported: 1 });
    } else
      await handleGitlabIssueOpened(
        app.db,
        app.get(EventBus),
        {
          object_attributes: {
            iid: 9,
            title: "Imported issue",
            description: "Body",
            url,
          },
          labels: labels.map((title) => ({ title, color: "#1a2b3c" })),
          project: {
            name: "repo",
            path_with_namespace: "team/repo",
            web_url: "https://git.example/team/repo",
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
      qualifying ? label.color : source === "manual" ? "#6B7280" : "#1a2b3c",
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
