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
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { JobLeaseEntity } from "../../src/database/entities/job-lease.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { WorkspaceUserEntity } from "../../src/database/entities/workspace-user.entity";
import { EventBus } from "../../src/events/event-bus";
import type { IntegrationPlugin } from "../../src/integrations/core/integration-plugin";
import { IntegrationPluginRegistry } from "../../src/integrations/core/integration-plugin-registry";
import type { TaskCreatedEvent } from "../../src/integrations/core/task-events";
import { createExternalLink } from "../../src/integrations/links/external-link-writes";
import { withTaskSyncCreation } from "../../src/integrations/sync/create-task-issue";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import type { SyncRules } from "../../src/integrations/sync/rules";
import { SyncReconciler } from "../../src/integrations/sync/sync-reconciler";
import { getSyncIntegration } from "../../src/integrations/sync-routes/get-sync-integration";
import { previewSyncRules } from "../../src/integrations/sync-routes/preview-sync-rules";
import { LabelDeletionService } from "../../src/label/label-deletion.service";
import { ProjectMoveService } from "../../src/project/project-move.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { PluginRegistryDouble } from "../support/fixtures/integrations-plugin-registry-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type CreatedIssue = { number: number; url: string };

// Ported from the reconciliation and creation-lease tests of
// tests/api-integration/integration-sync-providers.test.ts and from
// integration-sync-project-moved.test.ts. The Gitea plugin is a stand-in
// that exports through the shared engine like the real one: a creation lease,
// an issue request, then the link.
describe("sync reconciliation", () => {
  const giteaCreate = vi.fn<(event: TaskCreatedEvent) => Promise<CreatedIssue>>();
  let app: TestApp;
  const gitea: IntegrationPlugin = {
    type: "gitea",
    name: "Gitea (test)",
    validateConfig: async () => ({ valid: true }),
    onTaskCreated: async (event, context) => {
      await withTaskSyncCreation(app.db, event, context, async (current) => {
        const issue = await giteaCreate(current);
        await createExternalLink(app.db, {
          taskId: current.taskId,
          integrationId: context.integrationId,
          resourceType: "issue",
          externalId: String(issue.number),
          url: issue.url,
        });
      });
    },
  };

  beforeAll(async () => {
    app = await createTestApp({
      overrides: [
        [IntegrationPluginRegistry, new PluginRegistryDouble([gitea])],
      ],
    });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    let number = 11;
    giteaCreate.mockReset().mockImplementation(async () => ({
      number: ++number,
      url: `https://git.example/team/repo/issues/${number}`,
    }));
  });

  const reconciler = () => app.get(SyncReconciler);
  const links = () => app.db.find(ExternalLinkEntity);

  async function setup(type = "gitea") {
    const { workspace, user } = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const label = await insertRow(app.db, LabelEntity, {
      workspaceId: workspace.id,
      name: "export",
      color: "#123456",
    });
    const config = {
      baseUrl: "https://git.example",
      repositoryOwner: "team",
      repositoryName: "repo",
      accessToken: "fake-test-token",
      syncRules: {
        outgoing: { mode: "labels", match: "any", labels: [label.id] },
        incoming: { mode: "labels", match: "any", labels: ["export"] },
      } as SyncRules,
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      type,
      projectId: project.id,
      isActive: true,
      config: JSON.stringify(config),
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Export task",
      number: 1,
      status: "to-do",
      columnId: columns.todo.id,
    });
    const assign = (taskId = task.id) =>
      insertRow(app.db, LabelEntity, {
        taskId,
        workspaceId: workspace.id,
        name: label.name,
        color: label.color,
      });
    const addTask = async (number: number, title: string, labelled = true) => {
      const added = await createTask(app.db, {
        projectId: project.id,
        number,
        title,
        status: columns.todo.slug,
        columnId: columns.todo.id,
      });
      if (labelled) await assign(added.id);
      return added;
    };
    return {
      workspace,
      user,
      columns,
      project,
      integration,
      task,
      label,
      assign,
      addTask,
      config,
    };
  }

  it("exports a burst larger than the database pool without exhausting lease connections", async () => {
    const f = await setup();
    const tasks = [];
    for (let index = 0; index < 20; index++)
      tasks.push(await f.addTask(index + 2, `Burst task ${index}`));
    await Promise.all(
      tasks.map((task) => reconciler().reconcileTaskSync(f.project.id, task.id)),
    );
    expect(giteaCreate).toHaveBeenCalledTimes(20);
    expect(await links()).toHaveLength(20);
  });

  it("lets an unrelated export proceed while two provider calls are slow", async () => {
    const f = await setup();
    await f.assign();
    const other = await f.addTask(2, "Fast task");
    const secondSlow = await f.addTask(3, "Second slow task");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    giteaCreate.mockImplementation(async (event) => {
      if (event.title !== "Fast task") await gate;
      return {
        number: event.title === "Fast task" ? 13 : event.number + 20,
        url: `https://git.example/issues/${event.number}`,
      };
    });
    const slow = Promise.all([
      reconciler().reconcileTaskSync(f.project.id, f.task.id),
      reconciler().reconcileTaskSync(f.project.id, secondSlow.id),
    ]);
    try {
      await vi.waitFor(() => expect(giteaCreate).toHaveBeenCalledTimes(2));
      await reconciler().reconcileTaskSync(f.project.id, other.id);
      expect(
        await app.db.findOne(ExternalLinkEntity, {
          where: { taskId: other.id },
        }),
      ).toBeTruthy();
    } finally {
      release();
      await slow;
    }
  });

  it("retries a competing creation after the first attempt fails", async () => {
    const f = await setup();
    await f.assign();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    giteaCreate.mockImplementationOnce(async () => {
      await gate;
      throw new Error("Temporary provider failure");
    });
    const first = reconciler().reconcileTaskSync(f.project.id, f.task.id);
    await vi.waitFor(() => expect(giteaCreate).toHaveBeenCalledTimes(1));
    const competing = reconciler().reconcileTaskSync(f.project.id, f.task.id);
    release();
    await Promise.all([first, competing]);
    expect(giteaCreate).toHaveBeenCalledTimes(2);
    expect(await links()).toHaveLength(1);
  });

  it("runs task creation HTTP calls without an idle database transaction", async () => {
    const f = await setup();
    await f.assign();
    giteaCreate.mockImplementationOnce(async () => {
      const [row] = (await app.db.query(
        `select count(*)::text as transactions from pg_stat_activity
         where datname = current_database() and pid <> pg_backend_pid() and state = 'idle in transaction'`,
      )) as { transactions: string }[];
      expect(row!.transactions).toBe("0");
      return { number: 12, url: "https://git.example/issues/12" };
    });
    await reconciler().reconcileTaskSync(f.project.id, f.task.id);
    expect(await links()).toHaveLength(1);
  });

  it("waits for another instance's creation lease instead of dropping the export", async () => {
    const f = await setup();
    await f.assign();
    const key = `sync-create:${f.integration.id}:${f.task.id}`;
    await insertRow(app.db, JobLeaseEntity, {
      name: key,
      owner: "other-test-instance",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const competing = reconciler().reconcileTaskSync(f.project.id, f.task.id);
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(giteaCreate).not.toHaveBeenCalled();
    } finally {
      await app.db.delete(JobLeaseEntity, { name: key });
      await competing;
    }
    expect(giteaCreate).toHaveBeenCalledOnce();
    expect(await links()).toHaveLength(1);
  });

  it("refreshes scope once after a bulk run pauses multiple links", async () => {
    const f = await setup();
    const other = await f.addTask(2, "Other linked task", false);
    for (const [index, taskId] of [f.task.id, other.id].entries())
      await insertRow(app.db, ExternalLinkEntity, {
        taskId,
        integrationId: f.integration.id,
        resourceType: "issue",
        externalId: String(index + 1),
        url: `https://git.example/team/repo/issues/${index + 1}`,
      });
    const publish = vi.spyOn(app.get(EventBus), "publish");
    await reconciler().reconcileProjectSync(f.project.id);
    expect(
      publish.mock.calls.filter(([name]) => name === "task.updated"),
    ).toHaveLength(2);
    expect(
      publish.mock.calls.filter(([name]) => name === "project.updated"),
    ).toEqual([["project.updated", { projectId: f.project.id }]]);
  });

  it("broadcasts only changed links and avoids task scans for unconfigured integrations", async () => {
    const f = await setup();
    const publish = vi.spyOn(app.get(EventBus), "publish");
    await reconciler().reconcileProjectSync(f.project.id);
    expect(publish).not.toHaveBeenCalled();
    await f.assign();
    await reconciler().reconcileTaskSync(f.project.id, f.task.id);
    expect(publish.mock.calls).toEqual([
      ["task.updated", { projectId: f.project.id, taskId: f.task.id }],
      ["project.updated", { projectId: f.project.id }],
    ]);
    publish.mockClear();
    await reconciler().reconcileProjectSync(f.project.id);
    expect(publish).not.toHaveBeenCalled();
    const { syncRules: _, ...legacy } = f.config;
    await app.db.update(
      IntegrationEntity,
      { id: f.integration.id },
      { config: JSON.stringify(legacy) },
    );
    const query = vi.spyOn(app.dataSource.manager, "query");
    await reconciler().reconcileProjectSync(f.project.id);
    expect(
      query.mock.calls.every(([text]) => !/from task\b/i.test(String(text))),
    ).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it("continues after a task export throws and leaves failed tasks available for explicit retry", async () => {
    const f = await setup();
    await f.assign();
    await f.addTask(2, "Other task");
    const handler = vi
      .spyOn(gitea, "onTaskCreated")
      .mockRejectedValueOnce(new Error("Test creation lease failed"));
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    await reconciler().reconcileProjectSync(f.project.id, f.integration.id);
    expect(giteaCreate).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^Task sync reconciliation failed .*integration ${f.integration.id}`,
        ),
      ),
    );
    const integration = await getSyncIntegration(app.db, f.project.id, "gitea");
    expect(
      (await previewSyncRules(app.db, integration, f.config.syncRules))
        .willCreate,
    ).toBe(1);
    expect(await links()).toHaveLength(1);
    handler.mockRestore();
    await reconciler().reconcileProjectSync(f.project.id, f.integration.id);
    expect(giteaCreate).toHaveBeenCalledTimes(2);
    expect(
      (await previewSyncRules(app.db, integration, f.config.syncRules))
        .willCreate,
    ).toBe(0);
  });

  it("broadcasts deleted label availability even without changed links or an active integration", async () => {
    const f = await setup();
    const foreign = await setup();
    await app.db.update(
      IntegrationEntity,
      { id: f.integration.id },
      { isActive: false },
    );
    const publish = vi.spyOn(app.get(EventBus), "publish");
    await app.get(LabelDeletionService).deleteLabel(f.label.id, f.user.id);
    expect(publish).toHaveBeenCalledWith("project.updated", {
      projectId: f.project.id,
    });
    expect(publish).not.toHaveBeenCalledWith("project.updated", {
      projectId: foreign.project.id,
    });
    const integration = await getSyncIntegration(app.db, f.project.id, "gitea");
    expect(
      (await previewSyncRules(app.db, integration, f.config.syncRules))
        .missingLabels,
    ).toEqual([f.label.id]);
  });

  it("reconciles a project when its sync rules change", async () => {
    const f = await setup();
    await f.assign();
    const reconcile = vi.spyOn(reconciler(), "reconcileProjectSync");
    await app.get(EventBus).publish(
      "integration.sync_rules_changed",
      { projectId: f.project.id, integrationId: f.integration.id },
      { waitForHandlers: true },
    );
    expect(reconcile).toHaveBeenCalledWith(f.project.id, f.integration.id);
    expect(await links()).toEqual([
      expect.objectContaining({ taskId: f.task.id }),
    ]);
  });

  it.each(["task.label_created", "task.label_assigned", "task.labels_updated"])(
    "exports a task that newly matches after %s",
    async (event) => {
      const f = await setup();
      await f.assign();
      await app.get(EventBus).publish(
        event,
        { projectId: f.project.id, taskId: f.task.id },
        { waitForHandlers: true },
      );
      expect(giteaCreate).toHaveBeenCalledOnce();
      expect(await links()).toHaveLength(1);
    },
  );

  it.each(
    (["github", "gitea", "gitlab"] as const).flatMap((provider) =>
      [true, false].map((restricted) => ({ provider, restricted })),
    ),
  )(
    "$provider reconciles a project move (restricted=$restricted)",
    async ({ provider, restricted }) => {
      const source = await createWorkspaceMember(app.db);
      const target = await createWorkspaceMember(app.db);
      await insertRow(app.db, WorkspaceUserEntity, {
        workspaceId: target.workspace.id,
        userId: source.user.id,
        role: "owner",
        joinedAt: new Date(),
      });
      const { project, columns } = await createProjectFixture(app.db, {
        workspaceId: source.workspace.id,
      });
      const label = await insertRow(app.db, LabelEntity, {
        workspaceId: source.workspace.id,
        name: "export",
        color: "red",
      });
      await insertRow(app.db, LabelEntity, {
        workspaceId: target.workspace.id,
        name: "export",
        color: "red",
      });
      const integration = await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: provider,
        isActive: true,
        config: JSON.stringify({
          syncRules: {
            outgoing: restricted
              ? { mode: "labels", match: "any", labels: [label.id] }
              : { mode: "all" },
            incoming: { mode: "all" },
          },
        }),
      });
      const task = await createTask(app.db, {
        projectId: project.id,
        title: "Moved task",
        number: 1,
        status: "to-do",
        columnId: columns.todo.id,
      });
      await insertRow(app.db, LabelEntity, {
        taskId: task.id,
        workspaceId: source.workspace.id,
        name: "export",
        color: "red",
      });
      const link = await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: "9",
        url: "https://git.example/team/repo/issues/9",
        metadata: JSON.stringify({ retained: "keep" }),
      });
      let complete!: () => void;
      const completed = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const reconcile = reconciler().reconcileProjectSync.bind(reconciler());
      const handler = vi
        .spyOn(reconciler(), "reconcileProjectSync")
        .mockImplementationOnce(async (...args) => {
          try {
            await reconcile(...args);
          } finally {
            complete();
          }
        });
      const publish = vi.spyOn(app.get(EventBus), "publish");
      giteaCreate.mockClear();

      await app
        .get(ProjectMoveService)
        .moveProject(
          project.id,
          source.workspace.id,
          target.workspace.id,
          source.user.id,
        );
      await completed;

      expect(handler).toHaveBeenCalledWith(project.id, undefined);
      expect(publish).toHaveBeenCalledWith("project.updated", {
        projectId: project.id,
      });
      const stored = await app.db.findOne(ExternalLinkEntity, {
        where: { id: link.id },
      });
      expect(JSON.parse(stored!.metadata!)).toEqual(
        restricted
          ? { retained: "keep", syncFilterPaused: true }
          : { retained: "keep" },
      );
      expect(stored).toMatchObject({
        taskId: task.id,
        integrationId: integration.id,
        externalId: "9",
      });
      expect(await canSyncTask(app.db, task.id, integration.id)).toBe(
        !restricted,
      );
      expect(
        await app.db.findOne(LabelEntity, { where: { id: label.id } }),
      ).toMatchObject({ workspaceId: source.workspace.id });
      expect(giteaCreate).not.toHaveBeenCalled();
    },
  );
});
