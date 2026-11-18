import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { EventBus } from "../../src/events/event-bus";
import { LabelDeletionService } from "../../src/label/label-deletion.service";
import { LabelIntegrationSync } from "../../src/label/label-integration-sync";
import { LabelUpdateService } from "../../src/label/label-update.service";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import {
  createLabelIntegrationSyncDouble,
  resetLabelIntegrationSyncDouble,
} from "../support/label-integration-sync-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous tests also counted the events `notifySyncWorkspaceLabelChanged`
// published (`integration.sync_labels_changed`, and `project.updated` on
// deletion). That function lives behind `LabelIntegrationSync` now, so those
// expectations are assertions on the call into the seam.
const sync = createLabelIntegrationSyncDouble();

let app: TestApp;
let update: LabelUpdateService;
let deletion: LabelDeletionService;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp({ overrides: [[LabelIntegrationSync, sync]] });
  update = app.get(LabelUpdateService);
  deletion = app.get(LabelDeletionService);
  publish = vi.spyOn(app.get(EventBus), "publish");
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  resetLabelIntegrationSyncDouble(sync);
  publish.mockReset();
});

function task(projectId: string, number: number) {
  return createTask(app.db, {
    projectId,
    number,
    title: `Task ${number}`,
    status: "to-do",
  });
}

it("announces committed workspace label edits once per affected board", async () => {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project: first } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const { project: second } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const { workspace: otherWorkspace } = await createWorkspaceMember(app.db);
  const { project: foreign } = await createProjectFixture(app.db, {
    workspaceId: otherWorkspace.id,
  });
  const [a, b, c, privateTask] = await Promise.all([
    task(first.id, 1),
    task(first.id, 2),
    task(second.id, 1),
    task(foreign.id, 1),
  ]);
  const root = await createLabel(app.db, {
    workspaceId: workspace.id,
    name: "Old",
    color: "#000000",
  });
  for (const row of [a, b, c]) {
    await createLabel(app.db, {
      taskId: row.id,
      workspaceId: workspace.id,
      name: "Old",
      color: "#000000",
    });
  }
  await createLabel(app.db, {
    taskId: privateTask.id,
    workspaceId: otherWorkspace.id,
    name: "Old",
    color: "#000000",
  });

  await update.updateLabel(root.id, "Renamed", "#123456");

  expect(publish.mock.calls).toEqual(
    expect.arrayContaining([
      ["project.updated", { projectId: first.id }],
      ["project.updated", { projectId: second.id }],
    ]),
  );
  expect(publish).toHaveBeenCalledTimes(2);
  expect(sync.notifySyncWorkspaceLabelChanged.mock.calls).toEqual([
    [workspace.id, root.id, { publishProjectUpdates: false }],
  ]);
  const labels = await app.db.find(LabelEntity);
  expect(
    labels
      .filter((label) => label.workspaceId === workspace.id)
      .every((label) => label.name === "Renamed" && label.color === "#123456"),
  ).toBe(true);
  expect(labels.find((label) => label.taskId === privateTask.id)?.name).toBe(
    "Old",
  );
});

it("announces a direct task label recolor and emits nothing for a failed edit", async () => {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const row = await task(project.id, 1);
  const label = await createLabel(app.db, {
    taskId: row.id,
    workspaceId: workspace.id,
    name: "Bug",
    color: "#000000",
  });
  await update.updateLabel(label.id, "Bug", "#123456");
  expect(publish.mock.calls).toEqual([
    ["project.updated", { projectId: project.id }],
  ]);
  expect(sync.notifySyncWorkspaceLabelChanged).not.toHaveBeenCalled();
  publish.mockClear();
  await expect(
    update.updateLabel("missing", "Name", "#000000"),
  ).rejects.toThrow("Label not found");
  expect(publish).not.toHaveBeenCalled();
});

it("announces an unassigned workspace label edit to every local board's choices", async () => {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project: first } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const { project: second } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const { workspace: foreign } = await createWorkspaceMember(app.db);
  await createProjectFixture(app.db, { workspaceId: foreign.id });
  const label = await createLabel(app.db, {
    workspaceId: workspace.id,
    name: "Unassigned",
    color: "red",
  });
  publish.mockImplementation(async () => {
    expect(
      await app.db.findOne(LabelEntity, { where: { id: label.id } }),
    ).toMatchObject({ name: "Renamed", color: "blue" });
  });
  await update.updateLabel(label.id, "Renamed", "blue");
  expect(publish.mock.calls).toEqual(
    expect.arrayContaining([
      ["project.updated", { projectId: first.id }],
      ["project.updated", { projectId: second.id }],
    ]),
  );
  expect(publish).toHaveBeenCalledTimes(2);
});

it("refreshes sync label choices on deletion without requiring changed task links", async () => {
  const { workspace, user } = await createWorkspaceMember(app.db);
  await createProjectFixture(app.db, { workspaceId: workspace.id });
  const label = await createLabel(app.db, {
    workspaceId: workspace.id,
    name: "Unassigned",
    color: "red",
  });

  await deletion.deleteLabel(label.id, user.id);

  expect(sync.notifySyncWorkspaceLabelChanged.mock.calls).toEqual([
    [workspace.id, label.id],
  ]);
  expect(publish).not.toHaveBeenCalled();
  expect(
    await app.db.findOne(LabelEntity, { where: { id: label.id } }),
  ).toBeNull();
});
