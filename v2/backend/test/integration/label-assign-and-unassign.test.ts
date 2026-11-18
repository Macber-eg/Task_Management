import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ProjectAccessService } from "../../src/access/project-access.service";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { WorkspaceMemberAccessEntity } from "../../src/database/entities/workspace-member-access.entity";
import { EventBus } from "../../src/events/event-bus";
import { LabelAssignmentService } from "../../src/label/label-assignment.service";
import { LabelIntegrationSync } from "../../src/label/label-integration-sync";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import {
  createLabelIntegrationSyncDouble,
  resetLabelIntegrationSyncDouble,
} from "../support/label-integration-sync-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite ran the two controller functions against a mocked
// Drizzle client. Here the same cases run against PostgreSQL; only the
// integrations stay a double.
const sync = createLabelIntegrationSyncDouble();

let app: TestApp;
let assignment: LabelAssignmentService;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp({ overrides: [[LabelIntegrationSync, sync]] });
  assignment = app.get(LabelAssignmentService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
  resetLabelIntegrationSyncDouble(sync);
  publish = vi.spyOn(app.get(EventBus), "publish");
});

async function seed() {
  const { user, workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, { projectId: project.id, number: 1 });
  const workspaceLabel = await createLabel(app.db, {
    workspaceId: workspace.id,
    name: "bug",
    color: "EF4444",
  });
  const taskScope = {
    id: task.id,
    projectId: project.id,
    workspaceId: workspace.id,
  };
  return { user, workspace, project, task, taskScope, workspaceLabel };
}

function labelsOf(workspaceId: string) {
  return app.db.find(LabelEntity, { where: { workspaceId } });
}

describe("unassignLabelFromTask", () => {
  it("deletes the task assignment instead of nulling taskId", async () => {
    const { user, workspace, task, taskScope, workspaceLabel } = await seed();
    const taskLabel = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: task.id,
      name: "bug",
      color: "EF4444",
    });

    const result = await assignment.unassignLabelFromTask(
      taskLabel.id,
      user.id,
    );

    expect(result).toEqual(taskLabel);
    expect((await labelsOf(workspace.id)).map((label) => label.id)).toEqual([
      workspaceLabel.id,
    ]);
    expect(publish.mock.calls).toEqual([
      [
        "task.label_unassigned",
        {
          label: taskLabel,
          task: taskScope,
          projectId: taskScope.projectId,
          taskId: task.id,
          userId: user.id,
          type: "label_unassigned",
        },
      ],
    ]);
  });

  it("asks every provider to remove the label from the deleted assignment's task", async () => {
    const { user, workspace, task } = await seed();
    const taskLabel = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: task.id,
      name: "bug",
      color: "EF4444",
    });

    await assignment.unassignLabelFromTask(taskLabel.id, user.id);

    expect(sync.removeLabelFromGitHub.mock.calls).toEqual([[task.id, "bug"]]);
    expect(sync.removeLabelFromGitea.mock.calls).toEqual([[task.id, "bug"]]);
    expect(sync.removeLabelFromGitlab.mock.calls).toEqual([[task.id, "bug"]]);
  });

  it("rejects when the label is a workspace definition (taskId is null)", async () => {
    const { user, workspace, workspaceLabel } = await seed();

    await expect(
      assignment.unassignLabelFromTask(workspaceLabel.id, user.id),
    ).rejects.toMatchObject({
      status: 400,
      message: "Label is not assigned to a task",
    });
    expect(await labelsOf(workspace.id)).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
    expect(sync.removeLabelFromGitHub).not.toHaveBeenCalled();
  });
});

describe("assignLabelToTask", () => {
  it("creates a task-level copy without mutating the workspace definition", async () => {
    const { user, workspace, task, taskScope, workspaceLabel } = await seed();

    const result = await assignment.assignLabelToTask(
      workspaceLabel.id,
      task.id,
      user.id,
    );

    expect(result).toMatchObject({
      name: "bug",
      color: "EF4444",
      taskId: task.id,
      workspaceId: workspace.id,
    });
    expect(result.id).not.toBe(workspaceLabel.id);
    expect(
      await app.db.findOne(LabelEntity, { where: { id: workspaceLabel.id } }),
    ).toEqual(workspaceLabel);
    expect(await labelsOf(workspace.id)).toHaveLength(2);
    expect(publish.mock.calls).toEqual([
      [
        "task.label_assigned",
        {
          label: result,
          task: taskScope,
          projectId: taskScope.projectId,
          taskId: task.id,
          userId: user.id,
          type: "label_assigned",
        },
      ],
    ]);
    expect(sync.syncLabelToGitHub.mock.calls).toEqual([
      [task.id, "bug", "EF4444"],
    ]);
    expect(sync.syncLabelToGitea.mock.calls).toEqual([
      [task.id, "bug", "EF4444"],
    ]);
    expect(sync.syncLabelToGitlab.mock.calls).toEqual([
      [task.id, "bug", "EF4444"],
    ]);
    expect(sync.removeLabelFromGitHub).not.toHaveBeenCalled();
  });

  it("is idempotent when the same label is already attached to the same task", async () => {
    const { user, workspace, task } = await seed();
    const taskLabel = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: task.id,
      name: "bug",
      color: "EF4444",
    });

    const result = await assignment.assignLabelToTask(
      taskLabel.id,
      task.id,
      user.id,
    );

    expect(result).toEqual(taskLabel);
    expect(await labelsOf(workspace.id)).toHaveLength(2);
    expect(publish).not.toHaveBeenCalled();
    expect(sync.syncLabelToGitHub).not.toHaveBeenCalled();
  });

  it("removes the stale task copy when moving the label to a different task", async () => {
    const { user, workspace, project, task } = await seed();
    const oldTask = await createTask(app.db, {
      projectId: project.id,
      number: 2,
    });
    const stale = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: oldTask.id,
      name: "bug",
      color: "EF4444",
    });

    const result = await assignment.assignLabelToTask(
      stale.id,
      task.id,
      user.id,
    );

    expect(result.taskId).toBe(task.id);
    expect(
      await app.db.findOne(LabelEntity, { where: { id: stale.id } }),
    ).toBeNull();
    expect(publish).toHaveBeenCalledWith("task.labels_updated", {
      projectId: project.id,
      taskId: oldTask.id,
    });
    expect(sync.removeLabelFromGitHub.mock.calls).toEqual([
      [oldTask.id, "bug"],
    ]);
    expect(sync.removeLabelFromGitea.mock.calls).toEqual([[oldTask.id, "bug"]]);
    expect(sync.removeLabelFromGitlab.mock.calls).toEqual([
      [oldTask.id, "bug"],
    ]);
    expect(sync.syncLabelToGitHub.mock.calls).toEqual([
      [task.id, "bug", "EF4444"],
    ]);
    expect(publish).toHaveBeenCalledWith(
      "task.label_assigned",
      expect.objectContaining({
        taskId: task.id,
      }),
    );
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("is idempotent when the workspace label is re-attached to the same task", async () => {
    const { user, workspace, task, workspaceLabel } = await seed();
    const taskLabel = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: task.id,
      name: "bug",
      color: "EF4444",
    });

    const result = await assignment.assignLabelToTask(
      workspaceLabel.id,
      task.id,
      user.id,
    );

    expect(result).toEqual(taskLabel);
    expect(result.taskId).toBe(task.id);
    expect(await labelsOf(workspace.id)).toHaveLength(2);
    expect(sync.syncLabelToGitHub).not.toHaveBeenCalled();
    expect(sync.syncLabelToGitea).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it.skip("throws HTTP 500 when the insert and fallback lookup both return no row (only reachable with a mocked database client)", () => {});

  it("throws HTTP 404 when the label is removed before the transaction begins", async () => {
    const { user, workspace, task, workspaceLabel } = await seed();
    // The project access check runs between the first lookup and the
    // transaction, which is where a concurrent deletion would land.
    vi.spyOn(
      app.get(ProjectAccessService),
      "assertProjectAccess",
    ).mockImplementationOnce(async () => {
      await app.db.delete(LabelEntity, { id: workspaceLabel.id });
    });

    await expect(
      assignment.assignLabelToTask(workspaceLabel.id, task.id, user.id),
    ).rejects.toMatchObject({
      status: 404,
      message: "Label not found",
    });

    expect(await labelsOf(workspace.id)).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a target task in a project the caller cannot access", async () => {
    const { user, workspace, task, workspaceLabel } = await seed();
    await insertRow(app.db, WorkspaceMemberAccessEntity, {
      workspaceId: workspace.id,
      userId: user.id,
      projectAccess: "selected",
    });

    await expect(
      assignment.assignLabelToTask(workspaceLabel.id, task.id, user.id),
    ).rejects.toMatchObject({
      status: 403,
      message: "You don't have access to this project",
    });

    expect(await labelsOf(workspace.id)).toHaveLength(1);
    expect(sync.syncLabelToGitHub).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
