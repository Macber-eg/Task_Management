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
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { EventBus } from "../../src/events/event-bus";
import type { IntegrationPlugin } from "../../src/integrations/core/integration-plugin";
import { IntegrationPluginRegistry } from "../../src/integrations/core/integration-plugin-registry";
import { LabelIntegrationSync } from "../../src/label/label-integration-sync";
import { TaskLabelIntegrationSync } from "../../src/task/seams/task-label-integration-sync";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { PluginRegistryDouble } from "../support/fixtures/integrations-plugin-registry-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite exercised plugin dispatch through the real providers;
// these pin the registry, the event dispatch and the label seams directly.
describe("integration plugin framework", () => {
  const recorder = {
    onTaskCreated: vi.fn(),
    onTaskStatusChanged: vi.fn(),
    onTaskTitleChanged: vi.fn(),
    onTaskCommentCreated: vi.fn(),
    onTaskMoved: vi.fn(),
    onTaskDueDateChanged: vi.fn(),
  };
  const failing = { onTaskCreated: vi.fn() };
  const github = {
    syncTaskLabel: vi.fn(async () => undefined),
    removeTaskLabel: vi.fn(async () => undefined),
  };
  const plugins: IntegrationPlugin[] = [
    {
      type: "recorder",
      name: "Recorder",
      validateConfig: async () => ({ valid: true }),
      ...recorder,
    },
    {
      type: "failing",
      name: "Failing",
      validateConfig: async () => ({ valid: true }),
      ...failing,
    },
    {
      type: "github",
      name: "GitHub (test)",
      validateConfig: async () => ({ valid: true }),
      ...github,
    },
  ];
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      overrides: [
        [IntegrationPluginRegistry, new PluginRegistryDouble(plugins)],
      ],
    });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.clearAllMocks();
    for (const mock of Object.values(recorder))
      mock.mockResolvedValue(undefined);
    failing.onTaskCreated.mockRejectedValue(
      new Error("plugin failure for test"),
    );
  });

  async function setup() {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const integrate = (type: string, isActive = true) =>
      insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type,
        isActive,
        config: JSON.stringify({ channel: type }),
      });
    return { workspace, project, integrate };
  }

  const publish = (name: string, data: unknown) =>
    app.get(EventBus).publish(name, data, { waitForHandlers: true });

  it("registers each provider type once and lists them", () => {
    const registry = new IntegrationPluginRegistry();
    registry.register(plugins[0]!);
    expect(() => registry.register(plugins[0]!)).toThrow(
      "Plugin recorder already registered",
    );
    expect(registry.get("recorder")).toBe(plugins[0]);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.list()).toEqual([plugins[0]]);
  });

  it("dispatches task events to active integrations with their parsed config", async () => {
    const f = await setup();
    const active = await f.integrate("recorder");
    await f.integrate("failing");
    await publish("task.created", {
      taskId: "task-1",
      projectId: f.project.id,
      userId: "user-1",
      title: "New task",
      description: null,
      priority: "low",
      status: "to-do",
      number: 3,
      type: "create",
    });
    expect(recorder.onTaskCreated).toHaveBeenCalledWith(
      {
        taskId: "task-1",
        projectId: f.project.id,
        userId: "user-1",
        title: "New task",
        description: null,
        priority: "low",
        status: "to-do",
        number: 3,
      },
      {
        integrationId: active.id,
        projectId: f.project.id,
        config: { channel: "recorder" },
      },
    );
    expect(failing.onTaskCreated).toHaveBeenCalledOnce();
  });

  it("isolates plugin failures and skips inactive integrations and unknown types", async () => {
    const f = await setup();
    await f.integrate("failing");
    await insertRow(app.db, IntegrationEntity, {
      projectId: (await createProjectFixture(app.db, { workspaceId: f.workspace.id })).project.id,
      type: "recorder",
      config: "{}",
    });
    await f.integrate("unknown-provider");
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    await publish("comment.created", {
      taskId: "task-1",
      projectId: f.project.id,
      userId: "user-1",
      comment: "Hello",
    });
    expect(recorder.onTaskCommentCreated).not.toHaveBeenCalled();
    const inactive = await setup();
    await inactive.integrate("recorder", false);
    await publish("task.created", {
      taskId: "task-2",
      projectId: inactive.project.id,
      userId: "user-1",
      title: "Ignored",
      description: null,
      priority: null,
      status: "to-do",
      number: 1,
    });
    expect(recorder.onTaskCreated).not.toHaveBeenCalled();
    await publish("task.created", {
      taskId: "task-3",
      projectId: f.project.id,
      userId: "user-1",
      title: "Fails",
      description: null,
      priority: null,
      status: "to-do",
      number: 2,
    });
    expect(log).toHaveBeenCalledWith(
      "Plugin failing error on task.created:",
      expect.any(String),
    );
  });

  it("does not echo a change back to the integration it came from", async () => {
    const f = await setup();
    const source = await f.integrate("recorder");
    const event = {
      taskId: "task-1",
      projectId: f.project.id,
      userId: null,
      oldStatus: "to-do",
      newStatus: "done",
      title: "Task",
    };
    await publish("task.status_changed", {
      ...event,
      sourceIntegrationId: source.id,
    });
    expect(recorder.onTaskStatusChanged).not.toHaveBeenCalled();
    await publish("task.title_changed", {
      taskId: "task-1",
      projectId: f.project.id,
      userId: null,
      oldTitle: "Old",
      newTitle: "New",
      sourceIntegrationId: source.id,
    });
    expect(recorder.onTaskTitleChanged).not.toHaveBeenCalled();
    await publish("task.status_changed", event);
    expect(recorder.onTaskStatusChanged).toHaveBeenCalledWith(
      { ...event, sourceIntegrationId: undefined },
      expect.objectContaining({ integrationId: source.id }),
    );
  });

  it("dispatches a moved task to the destination project's integrations", async () => {
    const f = await setup();
    await f.integrate("recorder");
    await publish("task.moved", {
      taskId: "task-1",
      userId: "user-1",
      fromProjectId: "elsewhere",
      fromProjectName: "Elsewhere",
      toProjectId: f.project.id,
      toProjectName: "Here",
      oldStatus: "to-do",
      newStatus: "to-do",
    });
    expect(recorder.onTaskMoved).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: f.project.id,
        toProjectId: f.project.id,
      }),
      expect.anything(),
    );
  });

  it("routes label seams to the registered provider and skips missing ones", async () => {
    const labels = app.get(LabelIntegrationSync);
    await labels.syncLabelToGitHub("task-1", "bug", "#ff0000");
    await labels.removeLabelFromGitHub("task-1", "bug");
    await app.get(TaskLabelIntegrationSync).removeLabelFromGitHub("task-2", "x");
    expect(github.syncTaskLabel).toHaveBeenCalledWith(
      "task-1",
      "bug",
      "#ff0000",
    );
    expect(github.removeTaskLabel.mock.calls).toEqual([
      ["task-1", "bug"],
      ["task-2", "x"],
    ]);
    await expect(
      labels.syncLabelToGitea("task-1", "bug", "#ff0000"),
    ).resolves.toBeUndefined();
    await expect(
      labels.removeLabelFromGitlab("task-1", "bug"),
    ).resolves.toBeUndefined();
    await expect(
      app.get(TaskLabelIntegrationSync).removeLabelFromGitea("task-1", "bug"),
    ).resolves.toBeUndefined();
  });

  it("re-reconciles git integrations whose rules select a changed workspace label", async () => {
    const f = await setup();
    const label = await insertRow(app.db, LabelEntity, {
      workspaceId: f.workspace.id,
      name: "sync",
      color: "#123456",
    });
    const selecting = await insertRow(app.db, IntegrationEntity, {
      projectId: f.project.id,
      type: "gitea",
      config: JSON.stringify({
        syncRules: {
          outgoing: { mode: "labels", match: "any", labels: [label.id] },
          incoming: { mode: "all" },
        },
      }),
    });
    const other = await createProjectFixture(app.db, {
      workspaceId: f.workspace.id,
    });
    await insertRow(app.db, IntegrationEntity, {
      projectId: other.project.id,
      type: "github",
      config: JSON.stringify({}),
    });
    await createTask(app.db, { projectId: f.project.id });
    const bus = app.get(EventBus);
    const events = vi.spyOn(bus, "publish");
    await app
      .get(LabelIntegrationSync)
      .notifySyncWorkspaceLabelChanged(f.workspace.id, label.id);
    expect(events).toHaveBeenCalledWith("integration.sync_labels_changed", {
      projectId: f.project.id,
      integrationId: selecting.id,
    });
    expect(
      events.mock.calls
        .filter(([name]) => name === "project.updated")
        .map(([, data]) => data),
    ).toEqual(
      expect.arrayContaining([
        { projectId: f.project.id },
        { projectId: other.project.id },
      ]),
    );
    events.mockClear();
    await app
      .get(LabelIntegrationSync)
      .notifySyncWorkspaceLabelChanged(f.workspace.id, label.id, {
        publishProjectUpdates: false,
      });
    expect(
      events.mock.calls.some(([name]) => name === "project.updated"),
    ).toBe(false);
  });
});
