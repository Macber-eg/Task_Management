// Ported from the GitHub cases of the `describe.each` "label-filtered sync"
// block of tests/api-integration/integration-sync-providers.test.ts. The
// provider-neutral tests after that block are in
// integrations-sync-reconcile.test.ts; the Gitea/GitLab cases are listed as
// skipped. The previous suite replaced the App client, `addLabelsToIssue` and
// `providerIssue`; here the real GitHub plugin runs against the App double
// (`addLabels` is the label write, `issues.get` reads the issue) and the
// resume review reads through a `ProviderIssues` double.
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { Logger } from "@nestjs/common";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { EntityManager } from "typeorm";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { WorkflowRuleEntity } from "../../src/database/entities/workflow-rule.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { GitHubPlugin } from "../../src/integrations/github/github.plugin";
import { handleIssueLabeled } from "../../src/integrations/github/webhooks/issue-labeled";
import { handleIssueOpened } from "../../src/integrations/github/webhooks/issue-opened";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import { syncLatestTaskValue } from "../../src/integrations/links/sync-latest-task-value";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import { ProviderIssues } from "../../src/integrations/sync/provider-issues";
import type { SyncRules } from "../../src/integrations/sync/rules";
import { SyncReconciler } from "../../src/integrations/sync/sync-reconciler";
import { getSyncIntegration } from "../../src/integrations/sync-routes/get-sync-integration";
import { previewSyncRules } from "../../src/integrations/sync-routes/preview-sync-rules";
import { SyncResumeReviewService } from "../../src/integrations/sync-routes/sync-resume-review.service";
import { SyncResumeService } from "../../src/integrations/sync-routes/sync-resume.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite spied on the module export; here the real function is
// wrapped so its calls can be counted.
vi.mock("../../src/integrations/sync/eligibility", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/integrations/sync/eligibility")>();
  return { ...actual, canSyncTask: vi.fn(actual.canSyncTask) };
});

type Snapshot = {
  title: string;
  description: string;
  state: string;
  updatedAt: string;
  labels: string[];
};

describe("github label-filtered sync", () => {
  const double = createGitHubAppDouble();
  const { octokit } = double;
  const create = octokit.rest.issues.create;
  const update = octokit.rest.issues.update;
  const labels = octokit.rest.issues.addLabels;
  const comment = octokit.rest.issues.createComment;
  const comments = octokit.rest.issues.listComments;
  const read = vi.fn<() => Promise<Snapshot>>();
  const write = vi.fn<(values: Partial<Snapshot>) => Promise<unknown>>();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      overrides: [
        [GitHubApp, double.provider],
        [ProviderIssues, { open: async () => ({ read, write }) }],
      ],
    });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    vi.mocked(canSyncTask).mockClear();
    double.reset();
    update.mockResolvedValue(undefined);
    labels.mockResolvedValue(undefined);
    octokit.rest.issues.getLabel.mockResolvedValue({});
    octokit.rest.issues.removeLabel.mockResolvedValue(undefined);
    comment.mockResolvedValue({ id: 123 });
    comments.mockResolvedValue({ data: [] });
    read.mockReset().mockResolvedValue({
      title: "Repository title",
      description: "Repository body",
      state: "open",
      updatedAt: "2026-01-01T00:00:00Z",
      labels: ["export", "priority:low", "status:to-do", "remote-old"],
    });
    write.mockReset().mockImplementation(async (values) => {
      const current = await read.mock.results.at(-1)!.value;
      read.mockResolvedValue({
        ...current,
        ...values,
        updatedAt: "2026-01-02T00:00:00Z",
      });
      return { updatedAt: "2026-01-02T00:00:00Z" };
    });
    octokit.rest.issues.get.mockImplementation(async () => {
      const issue = await read();
      return {
        data: {
          title: issue.title,
          body: issue.description,
          state: issue.state,
          updated_at: issue.updatedAt,
          labels: issue.labels,
        },
      };
    });
    create.mockResolvedValue({
      data: {
        number: 12,
        html_url: "https://github.com/team/repo/issues/12",
        title: "Export task",
        state: "open",
      },
    });
  });

  const deps = () => githubDepsOf(app);
  const plugin = () => app.get(GitHubPlugin);
  const reconcileTaskSync = (projectId: string, taskId: string) =>
    app.get(SyncReconciler).reconcileTaskSync(projectId, taskId);
  const reconcileProjectSync = (projectId: string, integrationId?: string) =>
    app.get(SyncReconciler).reconcileProjectSync(projectId, integrationId);
  const links = () => app.db.find(ExternalLinkEntity);
  const findLink = (id: string) =>
    app.db.findOneOrFail(ExternalLinkEntity, { where: { id } });
  const metadata = (link: ExternalLinkEntity) =>
    JSON.parse(link.metadata!) as Record<string, unknown>;
  const setTask = (id: string, values: QueryDeepPartialEntity<TaskEntity>) =>
    app.db.update(TaskEntity, { id }, values);
  const idleTransactions = async (db: EntityManager = app.db) =>
    (
      (await db.query(
        `select count(*)::int as count from pg_stat_activity
         where datname = current_database() and state = 'idle in transaction'`,
      )) as { count: number }[]
    )[0]!.count;

  async function setup() {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const label = await insertRow(app.db, LabelEntity, {
      workspaceId: workspace.id,
      name: "export",
      color: "#123456",
    });
    const config = {
      repositoryOwner: "team",
      repositoryName: "repo",
      repositoryId: 1,
      installationId: 2,
      verifiedGithubAccountId: "3",
      verifiedByUserId: "test-user",
      baseUrl: "https://git.example",
      projectPath: "team/repo",
      accessToken: "fake-test-token",
      commentTaskLinkOnGitHubIssue: false,
      commentTaskLinkOnGiteaIssue: false,
      commentTaskLinkOnGitlabIssue: false,
      syncRules: {
        outgoing: {
          mode: "labels",
          match: "any",
          labels: [label.id] as string[],
        },
        incoming: { mode: "labels", match: "any", labels: ["export"] },
      },
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      type: "github",
      projectId: project.id,
      isActive: true,
      config: JSON.stringify(config),
    });
    await app.db.update(ProjectEntity, { id: project.id }, { lastTaskNumber: 1 });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Export task",
      number: 1,
      status: "to-do",
      columnId: columns.todo.id,
    });
    const assign = () =>
      insertRow(app.db, LabelEntity, {
        taskId: task.id,
        workspaceId: workspace.id,
        name: label.name,
        color: label.color,
      });
    const context = () => ({
      integrationId: integration.id,
      projectId: project.id,
      config,
    });
    const saveConfig = () =>
      app.db.update(
        IntegrationEntity,
        { id: integration.id },
        { config: JSON.stringify(config) },
      );
    return {
      workspace,
      columns,
      project,
      integration,
      task,
      assign,
      config,
      context,
      saveConfig,
    };
  }
  type Fixture = Awaited<ReturnType<typeof setup>>;
  const removeTaskLabels = (taskId: string) =>
    app.db.delete(LabelEntity, { taskId });
  const changeStatus = async (
    f: Fixture,
    oldStatus: string,
    newStatus: string,
    columnId: string,
  ) => {
    await setTask(f.task.id, { status: newStatus, columnId });
    await plugin().onTaskStatusChanged(
      {
        taskId: f.task.id,
        projectId: f.project.id,
        userId: null,
        title: f.task.title,
        oldStatus,
        newStatus,
      },
      f.context(),
    );
  };

  it("commits an inbound scope-label removal with a paused link before publishing", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    const [link] = await links();
    vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
    await handleIssueLabeled(deps(), {
      action: "unlabeled",
      installation: { id: 2 },
      repository: { id: 1, owner: { login: "team" }, name: "repo" },
      issue: { number: 12, labels: [] },
      label: { name: "export", color: "123456" },
    });
    expect(
      await app.db.find(LabelEntity, { where: { taskId: f.task.id } }),
    ).toEqual([]);
    expect(metadata(await findLink(link!.id))).toMatchObject({
      syncFilterPaused: true,
    });
    await f.assign();
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
  });

  it("exports equivalent formatted configurations while rejecting real changes", async () => {
    const f = await setup();
    await f.assign();
    await app.db.update(
      IntegrationEntity,
      { id: f.integration.id },
      { config: JSON.stringify(f.config, null, 2) },
    );
    const reordered = Object.fromEntries(Object.entries(f.config).reverse());
    expect(
      await canSyncTask(
        app.db,
        f.task.id,
        f.integration.id,
        JSON.stringify(reordered),
      ),
    ).toBe(true);
    expect(
      await canSyncTask(
        app.db,
        f.task.id,
        f.integration.id,
        JSON.stringify({ ...f.config, accessToken: "changed-test-token" }),
      ),
    ).toBe(false);
    expect(
      await canSyncTask(
        app.db,
        f.task.id,
        f.integration.id,
        JSON.stringify({
          ...f.config,
          syncRules: { ...f.config.syncRules, outgoing: { mode: "all" } },
        }),
      ),
    ).toBe(false);
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(create).toHaveBeenCalledOnce();
  });

  it("skips completed links and excluded unlinked tasks, while still pausing excluded links", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    for (let index = 0; index < 30; index++)
      await createTask(app.db, {
        projectId: f.project.id,
        title: "Unmatched task",
        number: index + 2,
        status: "to-do",
      });
    const guard = vi.mocked(canSyncTask);
    guard.mockClear();
    const publish = vi.spyOn(app.get(EventBus), "publish");
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(guard).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    await removeTaskLabels(f.task.id);
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(guard).toHaveBeenCalledOnce();
    const link = await app.db.findOneOrFail(ExternalLinkEntity, {
      where: { taskId: f.task.id },
    });
    expect(metadata(link)).toMatchObject({ syncFilterPaused: true });
    expect(
      publish.mock.calls.filter(([name]) => name === "project.updated"),
    ).toHaveLength(1);
    expect(create).toHaveBeenCalledOnce();
  });

  it("exports newly eligible tasks once, including their custom labels", async () => {
    const f = await setup();
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(create).not.toHaveBeenCalled();
    await f.assign();
    for (const name of ["status:done", "priority:high"])
      await insertRow(app.db, LabelEntity, {
        taskId: f.task.id,
        workspaceId: f.workspace.id,
        name,
        color: "#123456",
      });
    await Promise.all([
      reconcileTaskSync(f.project.id, f.task.id),
      reconcileProjectSync(f.project.id, f.integration.id),
    ]);
    expect(create).toHaveBeenCalledOnce();
    const names = labels.mock.calls[0]![0].labels as string[];
    expect(names).toContain("export");
    expect(names).toContain("status:to-do");
    expect(names).not.toContain("status:done");
    expect(names).not.toContain("priority:high");
    expect(
      await app.db.find(ExternalLinkEntity, { where: { taskId: f.task.id } }),
    ).toHaveLength(1);
    await removeTaskLabels(f.task.id);
    await reconcileTaskSync(f.project.id, f.task.id);
    await plugin().onTaskTitleChanged(
      {
        taskId: f.task.id,
        projectId: f.project.id,
        userId: null,
        oldTitle: "Export task",
        newTitle: "Excluded edit",
      },
      f.context(),
    );
    expect(update).not.toHaveBeenCalled();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    expect(create).toHaveBeenCalledOnce();
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
  });

  it("exports completed tasks with a closed issue and current link status", async () => {
    const f = await setup();
    await f.assign();
    await setTask(f.task.id, {
      status: f.columns.done.slug,
      columnId: f.columns.done.id,
    });
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]!.at(-1)).toMatchObject({ state: "closed" });
    const link = await app.db.findOneOrFail(ExternalLinkEntity, {
      where: { taskId: f.task.id },
    });
    expect(metadata(link)).toMatchObject({ state: "closed" });
  });

  it("reopens and closes exported issues when moving out of and into a custom final column", async () => {
    const f = await setup();
    await f.assign();
    const final = await insertRow(app.db, ColumnEntity, {
      projectId: f.project.id,
      name: "Shipped",
      slug: "shipped",
      position: 99,
      isFinal: true,
    });
    await setTask(f.task.id, { status: final.slug, columnId: final.id });
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(update.mock.calls[0]!.at(-1)).toMatchObject({ state: "closed" });
    update.mockClear();
    await changeStatus(f, final.slug, f.columns.todo.slug, f.columns.todo.id);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]!.at(-1)).toMatchObject({ state: "open" });
    await changeStatus(f, f.columns.todo.slug, final.slug, final.id);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]!.at(-1)).toMatchObject({ state: "closed" });
  });

  it("repairs a late initialization close after a concurrent reopen", async () => {
    const f = await setup();
    await f.assign();
    await setTask(f.task.id, {
      status: f.columns.done.slug,
      columnId: f.columns.done.id,
    });
    let started!: () => void;
    let release!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstClose = true;
    let remoteState = "open";
    update.mockImplementation(async (patch: { state?: string }) => {
      const state = patch.state ?? "open";
      if (state === "closed" && firstClose) {
        firstClose = false;
        started();
        await gate;
      }
      remoteState = state;
    });
    const exporting = reconcileTaskSync(f.project.id, f.task.id);
    try {
      await dispatched;
      await app.dataSource.transaction(async (tx) => {
        await tx.query(`set local lock_timeout = '1s'`);
        await tx.update(
          TaskEntity,
          { id: f.task.id },
          { status: f.columns.todo.slug, columnId: f.columns.todo.id },
        );
      });
      await plugin().onTaskStatusChanged(
        {
          taskId: f.task.id,
          projectId: f.project.id,
          userId: null,
          title: f.task.title,
          oldStatus: f.columns.done.slug,
          newStatus: f.columns.todo.slug,
        },
        f.context(),
      );
      expect(remoteState).toBe("open");
    } finally {
      release();
      await exporting;
    }
    expect(remoteState).toBe("open");
    const [link] = await links();
    expect(metadata(link!)).toMatchObject({
      state: "open",
      syncInitializedState: true,
      syncInitializationPending: false,
    });
  });

  it("retries an uncertain initialization close as open after the task changes", async () => {
    const f = await setup();
    await f.assign();
    await setTask(f.task.id, {
      status: f.columns.done.slug,
      columnId: f.columns.done.id,
    });
    let remoteState = "open";
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    update.mockImplementationOnce(async () => {
      remoteState = "closed";
      throw new Error("private-state-response-token");
    });
    await reconcileTaskSync(f.project.id, f.task.id);
    const [link] = await links();
    expect(metadata(link!)).toMatchObject({ syncInitializationPending: true });
    expect(metadata(link!).syncInitializedState).not.toBe(true);
    expect(remoteState).toBe("closed");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private-state-response-token",
    );
    await setTask(f.task.id, {
      status: f.columns.todo.slug,
      columnId: f.columns.todo.id,
    });
    update.mockImplementation(async (patch: { state?: string }) => {
      remoteState = patch.state ?? "open";
    });
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(create).toHaveBeenCalledOnce();
    expect(remoteState).toBe("open");
    const [completed] = await links();
    expect(metadata(completed!)).toMatchObject({
      state: "open",
      syncInitializedState: true,
      syncInitializationPending: false,
    });
  });

  it.each([false, true])(
    "replays edits made during creation and retries failed text initialization (failure=%s)",
    async (failure) => {
      const f = await setup();
      await f.assign();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const response = await create.getMockImplementation()!();
      create.mockImplementationOnce(async () => {
        await gate;
        return response;
      });
      if (failure)
        update.mockRejectedValueOnce(
          new Error("Temporary text initialization failure"),
        );
      const exportTask = reconcileTaskSync(f.project.id, f.task.id);
      try {
        await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
        await setTask(f.task.id, {
          title: "Edited title",
          description: "Edited description",
          status: f.columns.done.slug,
          columnId: f.columns.done.id,
          priority: "urgent",
        });
      } finally {
        release();
        await exportTask;
      }
      if (failure) {
        const [link] = await links();
        expect(metadata(link!)).toMatchObject({
          syncInitializationPending: true,
        });
        await reconcileTaskSync(f.project.id, f.task.id);
      }
      expect(create).toHaveBeenCalledOnce();
      const updates = update.mock.calls.map((call) => call.at(-1));
      expect(updates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "Edited title" }),
          expect.objectContaining({
            body: expect.stringContaining("Edited description"),
          }),
          expect.objectContaining({ state: "closed" }),
        ]),
      );
      const names = labels.mock.calls[0]![0].labels as string[];
      expect(names).toEqual(
        expect.arrayContaining(["priority:urgent", "status:done"]),
      );
      expect(names).not.toContain("status:to-do");
      const [link] = await links();
      expect(link!.title).toBe("Edited title");
      expect(metadata(link!)).toMatchObject({
        syncInitializationPending: false,
        syncInitializedText: {
          title: "Edited title",
          description: "Edited description",
        },
        state: "closed",
      });
    },
  );

  it.each(["labels", "rules", "deactivation"])(
    "pauses a dispatched creation after %s change without follow-up writes",
    async (change) => {
      const f = await setup();
      await f.assign();
      await setTask(f.task.id, {
        status: f.columns.done.slug,
        columnId: f.columns.done.id,
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      create.mockImplementationOnce(async () => {
        await gate;
        return {
          data: {
            number: 12,
            title: "Export task",
            state: "open",
            html_url: "https://git.example/issues/12",
          },
        };
      });
      const exportTask = reconcileTaskSync(f.project.id, f.task.id);
      try {
        await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
        if (change === "labels") await removeTaskLabels(f.task.id);
        else if (change === "deactivation")
          await app.db.update(
            IntegrationEntity,
            { id: f.integration.id },
            { isActive: false },
          );
        else
          await app.db.update(
            IntegrationEntity,
            { id: f.integration.id },
            {
              config: JSON.stringify({
                ...f.config,
                syncRules: {
                  ...f.config.syncRules,
                  outgoing: {
                    mode: "labels",
                    match: "any",
                    labels: ["missing-label"],
                  },
                },
              }),
            },
          );
      } finally {
        release();
        await exportTask;
      }
      const link = await app.db.findOneOrFail(ExternalLinkEntity, {
        where: { taskId: f.task.id },
      });
      expect(metadata(link)).toMatchObject({ syncFilterPaused: true });
      expect(update).not.toHaveBeenCalled();
      expect(labels).not.toHaveBeenCalled();
      expect(comment).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it.each(["state", "labels", "comment"] as const)(
    "retries incomplete %s initialization without recreating the issue",
    async (stage) => {
      const f = await setup();
      await f.assign();
      if (stage === "comment") {
        f.config.commentTaskLinkOnGitHubIssue = true;
        await f.saveConfig();
      }
      await setTask(f.task.id, {
        status: f.columns.done.slug,
        columnId: f.columns.done.id,
      });
      const failing = { state: update, labels, comment }[stage];
      failing.mockRejectedValueOnce(
        new Error("Temporary initialization failure"),
      );
      await reconcileTaskSync(f.project.id, f.task.id);
      const preview = async () =>
        previewSyncRules(
          app.db,
          await getSyncIntegration(app.db, f.project.id, "github"),
          f.config.syncRules as SyncRules,
        );
      expect((await preview()).willCreate).toBe(1);
      const link = await app.db.findOneOrFail(ExternalLinkEntity, {
        where: { taskId: f.task.id },
      });
      expect(metadata(link)).toMatchObject({ syncInitializationPending: true });
      await reconcileTaskSync(f.project.id, f.task.id);
      expect(create).toHaveBeenCalledOnce();
      expect(failing).toHaveBeenCalledTimes(2);
      expect((await preview()).willCreate).toBe(0);
      expect(await links()).toHaveLength(1);
    },
  );

  it.each(["first-page", "later-page", "read-failure", "scope-loss"] as const)(
    "reconciles an accepted comment with a lost response (%s) before retrying",
    async (scenario) => {
      const f = await setup();
      await f.assign();
      f.config.commentTaskLinkOnGitHubIssue = true;
      await f.saveConfig();
      let deliveredBody = "";
      comment.mockImplementationOnce(async ({ body }: { body: string }) => {
        deliveredBody = body;
        throw new Error("Comment accepted but its response was lost");
      });
      await reconcileTaskSync(f.project.id, f.task.id);
      const [link] = await links();
      expect(metadata(link!)).toMatchObject({
        syncInitializationPending: true,
      });
      comments.mockImplementation(async ({ page }: { page: number }) => {
        expect(await idleTransactions()).toBe(0);
        if (scenario === "scope-loss") {
          await removeTaskLabels(f.task.id);
          return { data: [] };
        }
        return {
          data:
            scenario === "later-page" && page === 1
              ? Array.from({ length: 100 }, () => ({ body: "Other comment" }))
              : [{ body: deliveredBody }],
        };
      });
      if (scenario === "read-failure") {
        const log = vi
          .spyOn(Logger.prototype, "error")
          .mockImplementation(() => {});
        comments.mockRejectedValueOnce(
          Object.assign(new Error("Read unavailable"), {
            request: { headers: { authorization: "private-provider-token" } },
          }),
        );
        await reconcileTaskSync(f.project.id, f.task.id);
        expect(JSON.stringify(log.mock.calls)).not.toContain(
          "private-provider-token",
        );
        log.mockRestore();
        expect(comment).toHaveBeenCalledOnce();
        expect(metadata(await findLink(link!.id))).toMatchObject({
          syncInitializationPending: true,
        });
      }
      await reconcileTaskSync(f.project.id, f.task.id);
      expect(create).toHaveBeenCalledOnce();
      expect(comment).toHaveBeenCalledOnce();
      expect(comments).toHaveBeenCalled();
      const completed = await findLink(link!.id);
      if (scenario === "scope-loss") {
        expect(metadata(completed)).toMatchObject({
          syncInitializationPending: true,
          syncFilterPaused: true,
        });
        return;
      }
      expect(metadata(completed)).toMatchObject({
        syncInitializationPending: false,
        syncInitializedComment: true,
      });
    },
  );

  it("does not dispatch a comment when its link is paused while the handler waits", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    comment.mockClear();
    const [link] = await links();
    const holder = app.dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    let pending: Promise<void> | undefined;
    try {
      await holder.query(
        "select id from external_link where id = $1 for update",
        [link!.id],
      );
      await holder.query(
        "update external_link set metadata = $2 where id = $1",
        [link!.id, JSON.stringify({ syncFilterPaused: true })],
      );
      pending = plugin().onTaskCommentCreated(
        {
          taskId: f.task.id,
          projectId: f.project.id,
          userId: "test-user",
          comment: "Excluded comment",
        },
        f.context(),
      );
      await vi.waitFor(async () => {
        const [result] = (await app.db.query(
          `select count(*)::int as waiting from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'
             and pid <> pg_backend_pid()`,
        )) as { waiting: number }[];
        expect(result!.waiting).toBeGreaterThan(0);
      });
    } finally {
      await holder.commitTransaction();
      await holder.release();
      await pending;
    }
    expect(comment).not.toHaveBeenCalled();
  });

  it("releases dispatch locks while the provider handles a comment", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    comment.mockClear();
    comment.mockImplementationOnce(async () => {
      await response;
      return { id: 123 };
    });
    const pending = plugin().onTaskCommentCreated(
      {
        taskId: f.task.id,
        projectId: f.project.id,
        userId: "test-user",
        comment: "Already dispatched",
      },
      f.context(),
    );
    try {
      await vi.waitFor(() => expect(comment).toHaveBeenCalledOnce());
      await removeTaskLabels(f.task.id);
      await reconcileTaskSync(f.project.id, f.task.id);
      const [link] = await links();
      expect(metadata(link!)).toMatchObject({ syncFilterPaused: true });
    } finally {
      release();
      await pending;
    }
  });

  it("records a successful outbound edit after its scope transaction fails", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    const [link] = await links();
    await setTask(f.task.id, { title: "New title" });
    const outbound = vi.fn(async () => "local-time");
    let injected = false;
    const transaction = app.db.transaction.bind(app.db) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    vi.spyOn(app.db, "transaction").mockImplementation(((
      ...args: unknown[]
    ) => {
      const apply = args.at(-1) as (tx: EntityManager) => Promise<unknown>;
      return transaction(...args.slice(0, -1), async (tx: EntityManager) => {
        const result = await apply(tx);
        if (!injected && outbound.mock.calls.length) {
          injected = true;
          throw new Error("Injected dispatch transaction failure");
        }
        return result;
      });
    }) as never);
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    await syncLatestTaskValue(
      app.db,
      app.get(EventBus),
      f.task.id,
      f.project.id,
      link!,
      "title",
      "New title",
      outbound,
      undefined,
      { type: "github", config: f.integration.config },
    );
    expect(injected).toBe(true);
    expect(outbound).toHaveBeenCalledOnce();
    const stored = await findLink(link!.id);
    expect(
      (metadata(stored).lastSync as Record<string, unknown>).title,
    ).toMatchObject({
      source: "kaneo",
      value: "New title",
      outbound: [
        expect.objectContaining({ pending: false, updatedAt: "local-time" }),
      ],
    });
    // The previous backend logged the ids as a second argument; the Nest
    // logger takes one message.
    expect(log).toHaveBeenCalledWith(
      `Issue write scope transaction failed after dispatch (integration ${f.integration.id}, link ${link!.id})`,
    );
  });

  it.each(["open", "closed"] as const)(
    "adopts the configured %s workflow target when resuming",
    async (state) => {
      const f = await setup();
      await f.assign();
      await reconcileTaskSync(f.project.id, f.task.id);
      const [link] = await links();
      const target = await insertRow(app.db, ColumnEntity, {
        projectId: f.project.id,
        name: "Mapped",
        slug: "mapped",
        position: 99,
        isFinal: state === "closed",
      });
      await insertRow(app.db, WorkflowRuleEntity, {
        projectId: f.project.id,
        integrationType: "github",
        eventType: state === "closed" ? "issue_closed" : "issue_reopened",
        columnId: target.id,
      });
      if (state === "open")
        await setTask(f.task.id, {
          status: f.columns.done.slug,
          columnId: f.columns.done.id,
        });
      await updateExternalLink(app.db, link!.id, {
        metadata: { syncFilterPaused: true },
      });
      read.mockResolvedValue({
        title: "Repository title",
        description: "Repository body",
        state,
        updatedAt: "remote-time",
        labels: [],
      });
      const review = await app
        .get(SyncResumeReviewService)
        .review(f.project.id, "github", link!.id, f.workspace.id);
      await app
        .get(SyncResumeService)
        .resumeSync(
          f.project.id,
          "github",
          link!.id,
          review.token,
          "provider",
          f.workspace.id,
        );
      expect(
        await app.db.findOneOrFail(TaskEntity, { where: { id: f.task.id } }),
      ).toMatchObject({ status: "mapped", columnId: target.id });
      expect(write).not.toHaveBeenCalled();
      expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(true);
    },
  );

  it.each(["kaneo", "provider"] as const)(
    "preserves unreviewed fields after resuming with %s and accepts later label changes",
    async (source) => {
      const f = await setup();
      await f.assign();
      await reconcileTaskSync(f.project.id, f.task.id);
      const [link] = await links();
      await updateExternalLink(app.db, link!.id, {
        metadata: { syncFilterPaused: true },
      });
      const planned = await insertRow(app.db, ColumnEntity, {
        projectId: f.project.id,
        name: "Planned",
        slug: "planned",
        position: -1,
        isFinal: false,
      });
      await setTask(f.task.id, {
        status: planned.slug,
        columnId: planned.id,
        priority: "urgent",
      });
      await insertRow(app.db, LabelEntity, {
        workspaceId: f.workspace.id,
        taskId: f.task.id,
        name: "local-only",
        color: "#123456",
      });
      const review = await app
        .get(SyncResumeReviewService)
        .review(f.project.id, "github", link!.id, f.workspace.id);
      await app
        .get(SyncResumeService)
        .resumeSync(
          f.project.id,
          "github",
          link!.id,
          review.token,
          source,
          f.workspace.id,
        );
      const baseline = ["export", "priority:low", "status:to-do", "remote-old"];
      const receive = (names: string[], added = "new-remote") =>
        handleIssueLabeled(deps(), {
          action: "labeled",
          installation: { id: 2 },
          repository: { id: 1, owner: { login: "team" }, name: "repo" },
          issue: { number: 12, labels: names },
          label: { name: added, color: "123456" },
        });
      const first = [...baseline, "new-remote"];
      await receive(first);
      expect(
        await app.db.findOneOrFail(TaskEntity, { where: { id: f.task.id } }),
      ).toMatchObject({
        priority: "urgent",
        status: "planned",
        columnId: planned.id,
      });
      const assigned = await app.db.find(LabelEntity, {
        where: { taskId: f.task.id },
      });
      expect(assigned.map((label) => label.name).sort()).toEqual([
        "export",
        "local-only",
        "new-remote",
      ]);
      await receive(
        [
          "export",
          "priority:high",
          "status:in-progress",
          "remote-old",
          "new-remote",
        ],
        "priority:high",
      );
      expect(
        await app.db.findOneOrFail(TaskEntity, { where: { id: f.task.id } }),
      ).toMatchObject({ priority: "high", status: "in-progress" });
    },
  );

  it("imports a closed issue gaining a label into a completed column", async () => {
    const f = await setup();
    await handleIssueLabeled(deps(), {
      action: "labeled",
      installation: { id: 2 },
      issue: {
        number: 99,
        title: "Closed issue",
        body: "Body",
        state: "closed",
        html_url: "https://github.com/team/repo/issues/99",
        labels: ["export"],
        user: { login: "author" },
      },
      repository: {
        id: 1,
        owner: { login: "team" },
        name: "repo",
        full_name: "team/repo",
      },
    } as Parameters<typeof handleIssueLabeled>[1]);
    const [link] = await links();
    expect(metadata(link!)).toMatchObject({ state: "closed" });
    expect(
      await app.db.findOneOrFail(TaskEntity, { where: { id: link!.taskId } }),
    ).toMatchObject({
      columnId: f.columns.done.id,
      status: f.columns.done.slug,
    });
  });

  it("admits only matching repository issues and deduplicates concurrent webhooks", async () => {
    const f = await setup();
    const receive = (issueLabels: string[]) =>
      handleIssueOpened(
        deps(),
        {
          action: "opened",
          installation: { id: 2 },
          issue: {
            number: 99,
            title: "Repository issue",
            body: "Body",
            html_url: "https://github.com/team/repo/issues/99",
            labels: issueLabels,
            user: { login: "author" },
          },
          repository: {
            id: 1,
            owner: { login: "team" },
            name: "repo",
            full_name: "team/repo",
          },
        },
        f.integration.id,
      );
    await receive(["other"]);
    expect(await links()).toHaveLength(0);
    await Promise.all([receive(["export"]), receive(["export"])]);
    const found = await links();
    expect(found).toHaveLength(1);
    expect(found[0]!.externalId).toBe("99");
    expect(await canSyncTask(app.db, found[0]!.taskId, f.integration.id)).toBe(
      true,
    );
    expect(
      await app.db.find(TaskEntity, { where: { projectId: f.project.id } }),
    ).toHaveLength(2);
  });

  // The Gitea/GitLab cases are in test/integration/gitea-sync-providers.test.ts and gitlab-sync-providers.test.ts.
});

// The Gitea/GitLab cases are in test/integration/gitea-sync-providers.test.ts and gitlab-sync-providers.test.ts.
