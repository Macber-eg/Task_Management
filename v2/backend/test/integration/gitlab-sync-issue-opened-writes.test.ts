import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { handleGitlabIssueOpened } from "../../src/integrations/gitlab/webhooks/issue-opened";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The GitLab cases of tests/api-integration/integration-sync-issue-opened-writes.test.ts.
const provider = vi.hoisted(() => ({ labels: vi.fn(), comment: vi.fn() }));
vi.mock("../../src/integrations/gitlab/client/gitlab-client", () => ({
  createGitlabClient: () => ({ createIssueNote: provider.comment }),
}));
vi.mock("../../src/integrations/gitlab/labels/issue-labels", () => ({
  updateIssueLabelsGitlab: async (...args: unknown[]) => {
    const write = args.at(-1);
    const send = () => provider.labels();
    return typeof write === "function" ? write(send) : send();
  },
}));

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
  provider.labels.mockReset().mockResolvedValue(undefined);
  provider.comment.mockReset().mockResolvedValue({ id: 123 });
});

it.each(
  ["excluded", "eligible", "before-write", "after-label", "failure"] as const,
)("guards gitlab issue-opened writes in the %s case", async (phase) => {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const label = await insertRow(app.db, LabelEntity, {
    workspaceId: workspace.id,
    name: "export",
    color: "#123456",
  });
  const baseUrl = "https://gitlab.example";
  const integration = await insertRow(app.db, IntegrationEntity, {
    projectId: project.id,
    type: "gitlab",
    isActive: true,
    config: JSON.stringify({
      baseUrl,
      repositoryOwner: "team",
      repositoryName: "repo",
      repositoryId: 1,
      installationId: 2,
      verifiedGithubAccountId: "3",
      verifiedByUserId: "test-user",
      accessToken: "test-only",
      projectPath: "team/repo",
      syncRules: {
        outgoing: { mode: "labels", match: "any", labels: [label.id] },
        incoming: { mode: "all" },
      },
    }),
  });
  const removeQualifyingLabel = async () => {
    const task = await app.db.findOne(TaskEntity, {
      where: { projectId: project.id },
    });
    await app.db.delete(LabelEntity, { taskId: task!.id, name: "export" });
  };
  const events = app.get(EventBus);
  const publish = vi
    .spyOn(events, "publish")
    .mockImplementation(async (name) => {
      if (name === "task.created" && phase === "before-write")
        await removeQualifyingLabel();
    });
  if (phase === "after-label")
    provider.labels.mockImplementationOnce(async () => {
      await vi.waitFor(async () => {
        const [activity] = (await app.db.query(
          `select count(*)::int as count from pg_stat_activity
           where datname = current_database() and state = 'idle in transaction'`,
        )) as { count: number }[];
        expect(activity!.count).toBe(0);
      });
      await removeQualifyingLabel();
    });
  if (phase === "failure")
    provider.comment.mockRejectedValueOnce(
      Object.assign(new Error("private-provider-write-response"), {
        request: {
          headers: { authorization: "private-provider-write-token" },
        },
      }),
    );
  const log = vi.spyOn(Logger.prototype, "error");
  const labels =
    phase === "excluded"
      ? ["status:IN-PROGRESS"]
      : ["export", "status:IN-PROGRESS"];
  await handleGitlabIssueOpened(
    app.db,
    events,
    {
      object_attributes: {
        iid: 99,
        title: "Imported issue",
        description: "Imported body",
        url: `${baseUrl}/team/repo/issues/99`,
      },
      labels: labels.map((title) => ({ title })),
      project: {
        name: "repo",
        path_with_namespace: "team/repo",
        web_url: `${baseUrl}/team/repo`,
      },
    },
    integration.id,
  );
  const tasks = await app.db.find(TaskEntity, {
    where: { projectId: project.id },
  });
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ title: "Imported issue" });
  const link = await app.db.findOne(ExternalLinkEntity, {
    where: { integrationId: integration.id },
  });
  expect(link).toMatchObject({ taskId: tasks[0]!.id, externalId: "99" });
  expect(
    publish.mock.calls.filter(([name]) => name === "task.created"),
  ).toHaveLength(1);
  const paused = ["excluded", "before-write", "after-label"].includes(phase);
  expect(JSON.parse(link!.metadata!).syncFilterPaused === true).toBe(paused);
  expect(provider.labels).toHaveBeenCalledTimes(
    ["excluded", "before-write"].includes(phase) ? 0 : 1,
  );
  expect(provider.comment).toHaveBeenCalledTimes(paused ? 0 : 1);
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "private-provider-write",
  );
});
