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
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { WorkflowRuleEntity } from "../../src/database/entities/workflow-rule.entity";
import { EventBus } from "../../src/events/event-bus";
import type { PluginContext } from "../../src/integrations/core/task-events";
import { GitlabPlugin } from "../../src/integrations/gitlab/gitlab.plugin";
import { handleGitlabIssueOpened } from "../../src/integrations/gitlab/webhooks/issue-opened";
import { handleGitlabIssueUpdated } from "../../src/integrations/gitlab/webhooks/issue-updated";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import { syncLatestTaskValue } from "../../src/integrations/links/sync-latest-task-value";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import type { SyncRules } from "../../src/integrations/sync/rules";
import { SyncReconciler } from "../../src/integrations/sync/sync-reconciler";
import { getSyncIntegration } from "../../src/integrations/sync-routes/get-sync-integration";
import { previewSyncRules } from "../../src/integrations/sync-routes/preview-sync-rules";
import { SyncResumeReviewService } from "../../src/integrations/sync-routes/sync-resume-review.service";
import { SyncResumeService } from "../../src/integrations/sync-routes/sync-resume.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The GitLab cases of the describe.each in
// tests/api-integration/integration-sync-providers.test.ts. As there, the
// GitLab client, label writes and issue access are replaced by mocks.
const mocks = vi.hoisted(() => ({
  gitlabCreate: vi.fn(),
  update: vi.fn(),
  labels: vi.fn(),
  comment: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../../src/integrations/gitlab/gitlab-issue-access", () => ({
  gitlabIssueAccess: () => ({ read: mocks.read, write: mocks.write }),
}));
vi.mock("../../src/integrations/gitlab/client/gitlab-client", () => ({
  createGitlabClient: () => ({
    createIssue: mocks.gitlabCreate,
    updateIssue: mocks.update,
    createIssueNote: mocks.comment,
  }),
}));
vi.mock("../../src/integrations/gitlab/labels/issue-labels", () => ({
  updateIssueLabelsGitlab: (
    config: unknown,
    number: number,
    changes: { add: string[] },
    ...args: unknown[]
  ) => mocks.labels(config, number, changes.add, ...args),
}));

describe("gitlab label-filtered sync", () => {
  let app: TestApp;
  let plugin: GitlabPlugin;
  let events: EventBus;
  const create = mocks.gitlabCreate;

  beforeAll(async () => {
    app = await createTestApp();
    plugin = app.get(GitlabPlugin);
    events = app.get(EventBus);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.update.mockReset().mockResolvedValue(undefined);
    mocks.labels.mockReset().mockResolvedValue(undefined);
    mocks.comment.mockReset().mockResolvedValue({ id: 123 });
    mocks.read.mockReset().mockResolvedValue({
      title: "Repository title",
      description: "Repository body",
      state: "open",
      updatedAt: "2026-01-01T00:00:00Z",
      labels: ["export", "priority:low", "status:to-do", "remote-old"],
    });
    mocks.write.mockReset().mockImplementation(async (values) => {
      const current = await mocks.read.mock.results.at(-1)!.value;
      mocks.read.mockResolvedValue({
        ...current,
        ...values,
        updatedAt: "2026-01-02T00:00:00Z",
      });
      return { updatedAt: "2026-01-02T00:00:00Z" };
    });
    create.mockReset().mockResolvedValue({
      iid: 12,
      web_url: "https://gitlab.example/team/repo/-/issues/12",
      title: "Export task",
      state: "opened",
    });
  });

  const reconcileTaskSync = (projectId: string, taskId: string) =>
    app.get(SyncReconciler).reconcileTaskSync(projectId, taskId);
  const reconcileProjectSync = (projectId: string, integrationId?: string) =>
    app.get(SyncReconciler).reconcileProjectSync(projectId, integrationId);
  const links = () => app.db.find(ExternalLinkEntity);
  const taskOf = (id: string) => app.db.findOne(TaskEntity, { where: { id } });
  const setTask = (id: string, values: Parameters<typeof app.db.update<TaskEntity>>[2]) =>
    app.db.update(TaskEntity, { id }, values);

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
      baseUrl: "https://gitlab.example",
      projectPath: "team/repo",
      accessToken: "fake-test-token",
      commentTaskLinkOnGitHubIssue: false,
      commentTaskLinkOnGiteaIssue: false,
      commentTaskLinkOnGitlabIssue: false,
      syncRules: {
        outgoing: {
          mode: "labels" as const,
          match: "any" as const,
          labels: [label.id],
        },
        incoming: {
          mode: "labels" as const,
          match: "any" as const,
          labels: ["export"],
        },
      },
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      type: "gitlab",
      projectId: project.id,
      isActive: true,
      config: JSON.stringify(config),
    });
    await app.db.query(
      `UPDATE project SET last_task_number = 1 WHERE id = $1`,
      [project.id],
    );
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
    const context = (): PluginContext => ({
      integrationId: integration.id,
      projectId: project.id,
      config,
    });
    return {
      workspace,
      columns,
      project,
      integration,
      task,
      assign,
      config,
      context,
    };
  }

  const gitlabProject = {
    name: "repo",
    path_with_namespace: "team/repo",
    web_url: "https://gitlab.example/team/repo",
  };

  it("commits an inbound scope-label removal with a paused link before publishing", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    const link = (await links())[0]!;
    vi.spyOn(events, "publish").mockResolvedValue(undefined);
    await handleGitlabIssueUpdated(
      app.db,
      events,
      {
        object_attributes: {
          iid: 12,
          title: "Export task",
          description: "",
          state: "opened",
          url: "https://gitlab.example/team/repo/-/issues/12",
        },
        changes: {
          labels: { previous: [{ title: "export" }], current: [] },
        },
        project: gitlabProject,
      },
      f.integration.id,
    );
    expect(
      await app.db.find(LabelEntity, { where: { taskId: f.task.id } }),
    ).toEqual([]);
    const paused = await app.db.findOne(ExternalLinkEntity, {
      where: { id: link.id },
    });
    expect(JSON.parse(paused!.metadata!)).toMatchObject({
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

  // The previous case also spied on canSyncTask through the module namespace,
  // which ES modules here do not allow; the observable outcome is kept.
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
    const publish = vi.spyOn(events, "publish");
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(publish).not.toHaveBeenCalled();
    await app.db.delete(LabelEntity, { taskId: f.task.id });
    await reconcileProjectSync(f.project.id, f.integration.id);
    const link = await app.db.findOne(ExternalLinkEntity, {
      where: { taskId: f.task.id },
    });
    expect(JSON.parse(link!.metadata!)).toMatchObject({
      syncFilterPaused: true,
    });
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
    const names = mocks.labels.mock.calls[0]![2] as string[];
    expect(names).toContain("export");
    expect(names).toContain("status:to-do");
    expect(names).not.toContain("status:done");
    expect(names).not.toContain("priority:high");
    expect(
      await app.db.find(ExternalLinkEntity, { where: { taskId: f.task.id } }),
    ).toHaveLength(1);
    await app.db.delete(LabelEntity, { taskId: f.task.id });
    await reconcileTaskSync(f.project.id, f.task.id);
    await plugin.onTaskTitleChanged(
      {
        taskId: f.task.id,
        projectId: f.project.id,
        userId: null,
        oldTitle: "Export task",
        newTitle: "Excluded edit",
      },
      f.context(),
    );
    expect(mocks.update).not.toHaveBeenCalled();
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
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0]!.at(-1)).toMatchObject({
      state_event: "close",
    });
    const link = await app.db.findOne(ExternalLinkEntity, {
      where: { taskId: f.task.id },
    });
    expect(JSON.parse(link!.metadata!)).toMatchObject({ state: "closed" });
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
    expect(mocks.update.mock.calls[0]!.at(-1)).toMatchObject({
      state_event: "close",
    });
    mocks.update.mockClear();
    const changeStatus = async (
      oldStatus: string,
      newStatus: string,
      columnId: string,
    ) => {
      await setTask(f.task.id, { status: newStatus, columnId });
      await plugin.onTaskStatusChanged(
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
    await changeStatus(final.slug, f.columns.todo.slug, f.columns.todo.id);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0]!.at(-1)).toMatchObject({
      state_event: "reopen",
    });
    await changeStatus(f.columns.todo.slug, final.slug, final.id);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[1]!.at(-1)).toMatchObject({
      state_event: "close",
    });
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
    mocks.update.mockImplementation(async (...args: unknown[]) => {
      const patch = args.at(-1) as { state_event?: string };
      const state = patch.state_event === "close" ? "closed" : "open";
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
      await plugin.onTaskStatusChanged(
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
    const link = (await links())[0]!;
    expect(JSON.parse(link.metadata!)).toMatchObject({
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
    const log = vi.spyOn(Logger.prototype, "error");
    mocks.update.mockImplementationOnce(async () => {
      remoteState = "closed";
      throw new Error("private-state-response-token");
    });
    await reconcileTaskSync(f.project.id, f.task.id);
    const link = (await links())[0]!;
    expect(JSON.parse(link.metadata!)).toMatchObject({
      syncInitializationPending: true,
    });
    expect(JSON.parse(link.metadata!).syncInitializedState).not.toBe(true);
    expect(remoteState).toBe("closed");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private-state-response-token",
    );
    await setTask(f.task.id, {
      status: f.columns.todo.slug,
      columnId: f.columns.todo.id,
    });
    mocks.update.mockImplementation(async (...args: unknown[]) => {
      const patch = args.at(-1) as { state_event?: string };
      remoteState = patch.state_event === "close" ? "closed" : "open";
    });
    await reconcileProjectSync(f.project.id, f.integration.id);
    expect(create).toHaveBeenCalledOnce();
    expect(remoteState).toBe("open");
    expect(JSON.parse((await links())[0]!.metadata!)).toMatchObject({
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
        mocks.update.mockRejectedValueOnce(
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
        const link = (await links())[0]!;
        expect(JSON.parse(link.metadata!)).toMatchObject({
          syncInitializationPending: true,
        });
        await reconcileTaskSync(f.project.id, f.task.id);
      }
      expect(create).toHaveBeenCalledOnce();
      const updates = mocks.update.mock.calls.map((call) => call.at(-1));
      expect(updates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "Edited title" }),
          expect.objectContaining({
            description: expect.stringContaining("Edited description"),
          }),
          expect.objectContaining({ state_event: "close" }),
        ]),
      );
      const names = mocks.labels.mock.calls[0]![2];
      expect(names).toEqual(
        expect.arrayContaining(["priority:urgent", "status:done"]),
      );
      expect(names).not.toContain("status:to-do");
      const link = (await links())[0]!;
      expect(link.title).toBe("Edited title");
      expect(JSON.parse(link.metadata!)).toMatchObject({
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
          iid: 12,
          title: "Export task",
          state: "opened",
          web_url: "https://git.example/issues/12",
        };
      });
      const exportTask = reconcileTaskSync(f.project.id, f.task.id);
      try {
        await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
        if (change === "labels")
          await app.db.delete(LabelEntity, { taskId: f.task.id });
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
      const link = await app.db.findOne(ExternalLinkEntity, {
        where: { taskId: f.task.id },
      });
      expect(JSON.parse(link!.metadata!)).toMatchObject({
        syncFilterPaused: true,
      });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.labels).not.toHaveBeenCalled();
      expect(mocks.comment).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it.each(["state", "labels"] as const)(
    "retries incomplete %s initialization without recreating the issue",
    async (stage) => {
      const f = await setup();
      await f.assign();
      await setTask(f.task.id, {
        status: f.columns.done.slug,
        columnId: f.columns.done.id,
      });
      const failing = { state: mocks.update, labels: mocks.labels }[stage];
      failing.mockRejectedValueOnce(
        new Error("Temporary initialization failure"),
      );
      await reconcileTaskSync(f.project.id, f.task.id);
      const integration = await getSyncIntegration(
        app.db,
        f.project.id,
        "gitlab",
      );
      expect(
        (
          await previewSyncRules(
            app.db,
            integration,
            f.config.syncRules as SyncRules,
          )
        ).willCreate,
      ).toBe(1);
      const link = await app.db.findOne(ExternalLinkEntity, {
        where: { taskId: f.task.id },
      });
      expect(JSON.parse(link!.metadata!)).toMatchObject({
        syncInitializationPending: true,
      });
      await reconcileTaskSync(f.project.id, f.task.id);
      expect(create).toHaveBeenCalledOnce();
      expect(failing).toHaveBeenCalledTimes(2);
      expect(
        (
          await previewSyncRules(
            app.db,
            integration,
            f.config.syncRules as SyncRules,
          )
        ).willCreate,
      ).toBe(0);
      expect(await links()).toHaveLength(1);
    },
  );

  it.each(["status:to-do", "priority:low"])(
    "preserves the local %s scope label when the outbound baseline contains it",
    async (name) => {
      const f = await setup();
      await f.assign();
      const root = await insertRow(app.db, LabelEntity, {
        workspaceId: f.workspace.id,
        name,
        color: "#123456",
      });
      await insertRow(app.db, LabelEntity, {
        workspaceId: f.workspace.id,
        taskId: f.task.id,
        name,
        color: root.color,
      });
      f.config.syncRules.outgoing.labels = [root.id];
      await app.db.update(
        IntegrationEntity,
        { id: f.integration.id },
        { config: JSON.stringify(f.config) },
      );
      await reconcileTaskSync(f.project.id, f.task.id);
      const link = (await links())[0]!;
      await updateExternalLink(app.db, link.id, {
        metadata: { syncResumeLabelBaseline: ["export", name] },
      });
      await handleGitlabIssueUpdated(
        app.db,
        events,
        {
          object_attributes: {
            iid: 12,
            title: f.task.title,
            description: "",
            state: "opened",
            url: "https://gitlab.example/team/repo/-/issues/12",
          },
          changes: {
            labels: {
              previous: [{ title: "export" }, { title: name }],
              current: [
                { title: "export" },
                { title: name },
                { title: "new-remote" },
              ],
            },
          },
          project: gitlabProject,
        },
        f.integration.id,
      );
      const assigned = await app.db.find(LabelEntity, {
        where: { taskId: f.task.id },
      });
      expect(assigned.map((label) => label.name)).toContain(name);
      expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(
        true,
      );
    },
  );

  it("does not dispatch a comment when its link is paused while the handler waits", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    mocks.comment.mockClear();
    const link = (await links())[0]!;
    const holder = app.dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(
      "select id from external_link where id = $1 for update",
      [link.id],
    );
    await holder.query(
      "update external_link set metadata = $2 where id = $1",
      [link.id, JSON.stringify({ syncFilterPaused: true })],
    );
    const comment = plugin.onTaskCommentCreated(
      {
        taskId: f.task.id,
        projectId: f.project.id,
        userId: "test-user",
        comment: "Excluded comment",
      },
      f.context(),
    );
    try {
      await vi.waitFor(async () => {
        const [result] = (await app.db.query(
          `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
        )) as { waiting: number }[];
        expect(result!.waiting).toBeGreaterThan(0);
      });
    } finally {
      await holder.commitTransaction();
      await holder.release();
      await comment;
    }
    expect(mocks.comment).not.toHaveBeenCalled();
  });

  it("releases dispatch locks while the provider handles a comment", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.comment.mockClear();
    mocks.comment.mockImplementationOnce(async () => {
      await response;
      return { id: 123 };
    });
    const comment = plugin.onTaskCommentCreated(
      {
        taskId: f.task.id,
        projectId: f.project.id,
        userId: "test-user",
        comment: "Already dispatched",
      },
      f.context(),
    );
    try {
      await vi.waitFor(() => expect(mocks.comment).toHaveBeenCalledOnce());
      await app.db.delete(LabelEntity, { taskId: f.task.id });
      await reconcileTaskSync(f.project.id, f.task.id);
      const link = (await links())[0]!;
      expect(JSON.parse(link.metadata!)).toMatchObject({
        syncFilterPaused: true,
      });
    } finally {
      release();
      await comment;
    }
  });

  it("records a successful outbound edit after its scope transaction fails", async () => {
    const f = await setup();
    await f.assign();
    await reconcileTaskSync(f.project.id, f.task.id);
    const link = (await links())[0]!;
    await setTask(f.task.id, { title: "New title" });
    const write = vi.fn(async () => "local-time");
    let injected = false;
    const transaction = app.db.transaction.bind(app.db) as (
      run: (tx: unknown) => Promise<unknown>,
    ) => Promise<unknown>;
    vi.spyOn(app.db, "transaction").mockImplementation(((
      run: (tx: unknown) => Promise<unknown>,
    ) =>
      transaction(async (tx) => {
        const result = await run(tx);
        if (!injected && write.mock.calls.length) {
          injected = true;
          throw new Error("Injected dispatch transaction failure");
        }
        return result;
      })) as never);
    const log = vi.spyOn(Logger.prototype, "error");
    await syncLatestTaskValue(
      app.db,
      events,
      f.task.id,
      f.project.id,
      link,
      "title",
      "New title",
      write,
      undefined,
      { type: "gitlab", config: f.integration.config },
    );
    expect(injected).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    const stored = await app.db.findOne(ExternalLinkEntity, {
      where: { id: link.id },
    });
    expect(JSON.parse(stored!.metadata!).lastSync.title).toMatchObject({
      source: "kaneo",
      value: "New title",
      outbound: [
        expect.objectContaining({ pending: false, updatedAt: "local-time" }),
      ],
    });
    expect(log).toHaveBeenCalledWith(
      `Issue write scope transaction failed after dispatch (integration ${f.integration.id}, link ${link.id})`,
    );
  });

  const review = (...args: Parameters<SyncResumeReviewService["review"]>) =>
    app.get(SyncResumeReviewService).review(...args);
  const resumeSync = (...args: Parameters<SyncResumeService["resumeSync"]>) =>
    app.get(SyncResumeService).resumeSync(...args);

  it.each(["open", "closed"] as const)(
    "adopts the configured %s workflow target when resuming",
    async (state) => {
      const f = await setup();
      await f.assign();
      await reconcileTaskSync(f.project.id, f.task.id);
      const link = (await links())[0]!;
      const target = await insertRow(app.db, ColumnEntity, {
        projectId: f.project.id,
        name: "Mapped",
        slug: "mapped",
        position: 99,
        isFinal: state === "closed",
      });
      await insertRow(app.db, WorkflowRuleEntity, {
        projectId: f.project.id,
        integrationType: "gitlab",
        eventType: state === "closed" ? "issue_closed" : "issue_reopened",
        columnId: target.id,
      });
      if (state === "open")
        await setTask(f.task.id, {
          status: f.columns.done.slug,
          columnId: f.columns.done.id,
        });
      await updateExternalLink(app.db, link.id, {
        metadata: { syncFilterPaused: true },
      });
      mocks.read.mockResolvedValue({
        title: "Repository title",
        description: "Repository body",
        state,
        updatedAt: "remote-time",
        labels: [],
      });
      const current = await review(
        f.project.id,
        "gitlab",
        link.id,
        f.workspace.id,
      );
      await resumeSync(
        f.project.id,
        "gitlab",
        link.id,
        current.token,
        "provider",
        f.workspace.id,
      );
      expect(await taskOf(f.task.id)).toMatchObject({
        status: "mapped",
        columnId: target.id,
      });
      expect(mocks.write).not.toHaveBeenCalled();
      expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(
        true,
      );
    },
  );

  it.each(["kaneo", "provider"] as const)(
    "preserves unreviewed fields after resuming with %s and accepts later label changes",
    async (source) => {
      const f = await setup();
      await f.assign();
      await reconcileTaskSync(f.project.id, f.task.id);
      const link = (await links())[0]!;
      await updateExternalLink(app.db, link.id, {
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
      const current = await review(
        f.project.id,
        "gitlab",
        link.id,
        f.workspace.id,
      );
      await resumeSync(
        f.project.id,
        "gitlab",
        link.id,
        current.token,
        source,
        f.workspace.id,
      );
      const baseline = ["export", "priority:low", "status:to-do", "remote-old"];
      const receive = (names: string[], previous: string[]) =>
        handleGitlabIssueUpdated(
          app.db,
          events,
          {
            object_attributes: {
              iid: 12,
              title: "Repository title",
              description: "Repository body",
              state: "opened",
              url: "https://gitlab.example/team/repo/-/issues/12",
            },
            changes: {
              labels: {
                previous: previous.map((title) => ({ title })),
                current: names.map((title) => ({ title })),
              },
            },
            project: gitlabProject,
          },
          f.integration.id,
        );
      const first = [...baseline, "new-remote"];
      await receive(first, baseline);
      expect(await taskOf(f.task.id)).toMatchObject({
        priority: "urgent",
        status: "planned",
        columnId: planned.id,
      });
      const labels = await app.db.find(LabelEntity, {
        where: { taskId: f.task.id },
      });
      expect(labels.map((label) => label.name).sort()).toEqual([
        "export",
        "local-only",
        "new-remote",
      ]);
      const changed = [
        "export",
        "priority:high",
        "status:in-progress",
        "remote-old",
        "new-remote",
      ];
      await receive(changed, first);
      expect(await taskOf(f.task.id)).toMatchObject({
        priority: "high",
        status: "in-progress",
      });
    },
  );

  it("imports a closed issue gaining a label into a completed column", async () => {
    const f = await setup();
    // GitLab can send the authoritative labels only inside the change.
    await handleGitlabIssueUpdated(
      app.db,
      events,
      {
        object_attributes: {
          iid: 99,
          title: "Closed issue",
          description: "Body",
          state: "closed",
          url: "https://gitlab.example/team/repo/-/issues/99",
        },
        changes: {
          labels: { previous: [], current: [{ title: "export" }] },
        },
        project: gitlabProject,
      },
      f.integration.id,
    );
    const link = (await links())[0]!;
    expect(JSON.parse(link.metadata!)).toMatchObject({ state: "closed" });
    expect(await taskOf(link.taskId)).toMatchObject({
      columnId: f.columns.done.id,
      status: f.columns.done.slug,
    });
  });

  it("admits only matching repository issues and deduplicates concurrent webhooks", async () => {
    const f = await setup();
    const receive = (labels: string[]) =>
      handleGitlabIssueOpened(
        app.db,
        events,
        {
          object_attributes: {
            iid: 99,
            title: "Repository issue",
            description: "Body",
            url: "https://gitlab.example/team/repo/-/issues/99",
          },
          labels: labels.map((title) => ({ title })),
          project: gitlabProject,
        },
        f.integration.id,
      );
    await receive(["other"]);
    expect(await links()).toHaveLength(0);
    await Promise.all([receive(["export"]), receive(["export"])]);
    const stored = await links();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.externalId).toBe("99");
    expect(await canSyncTask(app.db, stored[0]!.taskId, f.integration.id)).toBe(
      true,
    );
    expect(
      await app.db.find(TaskEntity, { where: { projectId: f.project.id } }),
    ).toHaveLength(2);
  });
});
