import { randomUUID } from "node:crypto";
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
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { AssetEntity } from "../../src/database/entities/asset.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { UserNotificationWorkspaceProjectEntity } from "../../src/database/entities/user-notification-workspace-project.entity";
import { UserNotificationWorkspaceRuleEntity } from "../../src/database/entities/user-notification-workspace-rule.entity";
import { EventBus } from "../../src/events/event-bus";
import { RealtimeConnections } from "../../src/realtime/realtime-connections";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import {
  realtimeDouble,
  resetRealtimeDouble,
} from "../support/realtime-double";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const realtime = realtimeDouble();
let app: TestApp;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp({ overrides: [[RealtimeConnections, realtime]] });
  publish = vi.spyOn(app.get(EventBus), "publish");
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  resetRealtimeDouble(realtime);
  publish.mockClear();
  app.auth.signOut();
});

function createTargetWorkspace() {
  return createWorkspace(app.db, { name: "Target Workspace" });
}

function move(projectId: string, workspaceId: string) {
  return app.request(`/api/project/${projectId}/move`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
}

async function workspaceOf(projectId: string) {
  const project = await app.db.findOneOrFail(ProjectEntity, {
    where: { id: projectId },
  });
  return project.workspaceId;
}

describe("API integration: moving a project between workspaces", () => {
  it("rejects a move into a workspace the caller doesn't belong to", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const target = await createTargetWorkspace();
    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Destination workspace not found");
    expect(await workspaceOf(project.id)).toBe(owner.workspace.id);
  });

  it("rejects a move when the caller can't create projects in the target", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const target = await createTargetWorkspace();
    // `viewer` grants only project:read in the target workspace.
    await addWorkspaceMember(app.db, target.id, owner.user.id, "viewer");
    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(403);
  });

  it("rejects a move when the caller can't manage target workspace settings", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const target = await createTargetWorkspace();
    // Members can create projects but lack workspace:manage_settings.
    await addWorkspaceMember(app.db, target.id, owner.user.id, "member");
    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(403);
    expect(await workspaceOf(project.id)).toBe(owner.workspace.id);
  });

  it("rejects a move when the target workspace already uses the project's key", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const target = await createTargetWorkspace();
    await addWorkspaceMember(app.db, target.id, owner.user.id, "owner");

    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
      slug: "kan",
    });
    // Different case on purpose: keys collide case-insensitively.
    await createProjectFixture(app.db, {
      workspaceId: target.id,
      name: "Incumbent",
      slug: "KAN",
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Incumbent");
    expect(await workspaceOf(project.id)).toBe(owner.workspace.id);
  });

  it("allows a move when only the source workspace uses that key", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const target = await createTargetWorkspace();
    await addWorkspaceMember(app.db, target.id, owner.user.id, "owner");

    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
      slug: "kan",
    });
    await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
      name: "Sibling",
      slug: "kan",
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(200);
    expect(await workspaceOf(project.id)).toBe(target.id);
  });

  it("appends the moved project to the end of the target's ordering", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const target = await createTargetWorkspace();
    await addWorkspaceMember(app.db, target.id, owner.user.id, "owner");

    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });
    const { project: firstInTarget } = await createProjectFixture(app.db, {
      workspaceId: target.id,
      name: "First",
    });
    const { project: secondInTarget } = await createProjectFixture(app.db, {
      workspaceId: target.id,
      name: "Second",
    });
    await app.db.update(
      ProjectEntity,
      { id: secondInTarget.id },
      { position: 1 },
    );

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(200);

    const moved = await app.db.findOneOrFail(ProjectEntity, {
      where: { id: project.id },
    });
    expect(moved.position).toBe(2);

    const positions = await app.db.find(ProjectEntity, {
      where: { workspaceId: target.id },
      select: { id: true, position: true },
    });
    expect(
      [...positions].sort((a, b) => a.position - b.position).map((p) => p.id),
    ).toEqual([firstInTarget.id, secondInTarget.id, project.id]);
    expect(new Set(positions.map((p) => p.position)).size).toBe(3);
  });

  it("rejects a move out of a workspace where the caller can't delete projects", async () => {
    const mover = await createWorkspaceMember(app.db, {
      role: "project-editor",
    });
    const target = await createTargetWorkspace();
    // Full rights in the target, so a 403 can only come from the source.
    await addWorkspaceMember(app.db, target.id, mover.user.id, "owner");
    // Only a custom role holds `update` without `delete`.
    await addWorkspaceRole(app.db, mover.workspace.id, "project-editor", {
      project: ["create", "read", "update"],
    });

    const { project } = await createProjectFixture(app.db, {
      workspaceId: mover.workspace.id,
    });

    app.auth.signIn(mover.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(403);
    expect(await workspaceOf(project.id)).toBe(mover.workspace.id);
  });

  it("rejects a move into the workspace the project is already in", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, owner.workspace.id);

    expect(response.status).toBe(400);
  });

  it("moves the project and rewrites workspace-scoped side data", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const target = await createTargetWorkspace();
    await addWorkspaceMember(app.db, target.id, owner.user.id, "owner");

    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });

    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Ship it",
      columnId: columns.todo.id,
      number: 1,
      userId: owner.user.id,
    });

    const label = await insertRow(app.db, LabelEntity, {
      name: "bug",
      color: "#ff0000",
      taskId: task.id,
      workspaceId: owner.workspace.id,
    });

    const asset = await insertRow(app.db, AssetEntity, {
      workspaceId: owner.workspace.id,
      projectId: project.id,
      taskId: task.id,
      objectKey: `object-${randomUUID()}`,
      filename: "screenshot.png",
      mimeType: "image/png",
      size: 1234,
    });

    // A notification rule referencing the project through the composite
    // (workspaceId, projectId) key. Left in place, the workspace update
    // would cascade into it and break the rule-side key.
    const rule = await insertRow(app.db, UserNotificationWorkspaceRuleEntity, {
      userId: owner.user.id,
      workspaceId: owner.workspace.id,
      projectMode: "selected",
    });
    await insertRow(app.db, UserNotificationWorkspaceProjectEntity, {
      workspaceId: owner.workspace.id,
      workspaceRuleId: rule.id,
      projectId: project.id,
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown> & {
      workspaceId: string;
      unassignedTaskCount: number;
    };
    expect(payload.workspaceId).toBe(target.id);
    expect(payload.unassignedTaskCount).toBe(0);
    expect(payload).not.toHaveProperty("backgroundObjectKey");
    expect(payload).not.toHaveProperty("backgroundMimeType");

    expect(await workspaceOf(project.id)).toBe(target.id);

    const movedLabel = await app.db.findOneOrFail(LabelEntity, {
      where: { id: label.id },
    });
    expect(movedLabel.workspaceId).toBe(target.id);

    const movedAsset = await app.db.findOneOrFail(AssetEntity, {
      where: { id: asset.id },
    });
    expect(movedAsset.workspaceId).toBe(target.id);

    expect(
      await app.db.find(UserNotificationWorkspaceProjectEntity, {
        where: { projectId: project.id },
      }),
    ).toHaveLength(0);

    // The task and its column survive the move.
    const movedTask = await app.db.findOneOrFail(TaskEntity, {
      where: { id: task.id },
    });
    expect(movedTask.columnId).toBe(columns.todo.id);

    const sourceListing = await app.request(
      `/api/project?workspaceId=${owner.workspace.id}`,
    );
    expect(sourceListing.status).toBe(200);
    const sourceProjects = (await sourceListing.json()) as { id: string }[];
    expect(sourceProjects.map((item) => item.id)).not.toContain(project.id);

    expect(realtime.closeProjectConnections).toHaveBeenCalledWith(project.id);
    expect(publish).toHaveBeenCalledWith("integration.sync_labels_changed", {
      projectId: project.id,
    });
    expect(publish).toHaveBeenCalledWith("project.updated", {
      projectId: project.id,
    });
    expect(publish).not.toHaveBeenCalledWith(
      "task.bulk_unassigned",
      expect.anything(),
    );
  });

  it("unassigns tasks whose assignee isn't a member of the target workspace", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const outsider = await createWorkspaceMember(app.db, { role: "member" });
    const target = await createTargetWorkspace();
    await addWorkspaceMember(app.db, target.id, owner.user.id, "owner");
    // `outsider.user` is deliberately never added to the target workspace.
    await addWorkspaceMember(
      app.db,
      owner.workspace.id,
      outsider.user.id,
      "member",
    );

    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });

    const keptTask = await createTask(app.db, {
      projectId: project.id,
      title: "Stays assigned",
      columnId: columns.todo.id,
      number: 1,
      userId: owner.user.id,
    });
    const droppedTask = await createTask(app.db, {
      projectId: project.id,
      title: "Loses its assignee",
      columnId: columns.todo.id,
      number: 2,
      userId: outsider.user.id,
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { unassignedTaskCount: number };
    expect(payload.unassignedTaskCount).toBe(1);

    const kept = await app.db.findOneOrFail(TaskEntity, {
      where: { id: keptTask.id },
    });
    expect(kept.userId).toBe(owner.user.id);

    const dropped = await app.db.findOneOrFail(TaskEntity, {
      where: { id: droppedTask.id },
    });
    expect(dropped.userId).toBeNull();

    // Written in the move's transaction, so present once the request returns.
    const activities = await app.db.find(ActivityEntity, {
      where: { taskId: droppedTask.id },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0]?.type).toBe("unassigned");
    expect(activities[0]?.userId).toBe(owner.user.id);

    expect(
      await app.db.find(ActivityEntity, { where: { taskId: keptTask.id } }),
    ).toHaveLength(0);

    expect(publish).toHaveBeenCalledWith("task.bulk_unassigned", {
      projectId: project.id,
      userId: owner.user.id,
    });
  });

  // An empty target member set drops that term from the unassignment; the
  // remaining predicate still has to stay scoped to this project.
  it("unassigns every task when no assignee is a member of the target", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const outsider = await createWorkspaceMember(app.db, { role: "member" });
    const target = await createTargetWorkspace();
    await addWorkspaceMember(app.db, target.id, owner.user.id, "owner");
    await addWorkspaceMember(
      app.db,
      owner.workspace.id,
      outsider.user.id,
      "member",
    );

    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });
    const other = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });

    const movedTask = await createTask(app.db, {
      projectId: project.id,
      title: "Loses its assignee",
      columnId: columns.todo.id,
      number: 1,
      userId: outsider.user.id,
    });
    const untouchedTask = await createTask(app.db, {
      projectId: other.project.id,
      title: "Belongs to another project",
      columnId: other.columns.todo.id,
      number: 1,
      userId: outsider.user.id,
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { unassignedTaskCount: number };
    expect(payload.unassignedTaskCount).toBe(1);

    const moved = await app.db.findOneOrFail(TaskEntity, {
      where: { id: movedTask.id },
    });
    expect(moved.userId).toBeNull();

    const untouched = await app.db.findOneOrFail(TaskEntity, {
      where: { id: untouchedTask.id },
    });
    expect(untouched.userId).toBe(outsider.user.id);
  });
});

describe("project move task relationships", () => {
  it.each(["incoming", "outgoing", "internal"])(
    "protects %s relationships",
    async (direction) => {
      const owner = await createWorkspaceMember(app.db, { role: "owner" });
      const target = await createTargetWorkspace();
      await addWorkspaceMember(app.db, target.id, owner.user.id, "owner");
      const { project } = await createProjectFixture(app.db, {
        workspaceId: owner.workspace.id,
      });
      const { project: other } = await createProjectFixture(app.db, {
        workspaceId: owner.workspace.id,
      });
      const tasks = [
        await createTask(app.db, {
          title: "Moving",
          projectId: project.id,
          number: 1,
        }),
        await createTask(app.db, {
          title: "Related",
          projectId: direction === "internal" ? project.id : other.id,
          number: 2,
        }),
      ];
      const relation = await insertRow(app.db, TaskRelationEntity, {
        sourceTaskId: tasks[direction === "incoming" ? 1 : 0]?.id,
        targetTaskId: tasks[direction === "incoming" ? 0 : 1]?.id,
        relationType: "blocks",
      });

      app.auth.signIn(owner.user);
      const response = await move(project.id, target.id);

      expect(response.status).toBe(direction === "internal" ? 200 : 409);
      expect(await workspaceOf(project.id)).toBe(
        direction === "internal" ? target.id : owner.workspace.id,
      );
      expect(
        await app.db.find(TaskRelationEntity, { where: { id: relation.id } }),
      ).toHaveLength(1);
    },
  );
});

describe("project move concurrency and realtime access", () => {
  // The previous test registered a socket and checked the PROJECT_MOVED
  // message and close code; that belongs to the realtime layer now, so this
  // asserts the call into it.
  it("closes old project sockets even when there are no tasks to unassign", async () => {
    const owner = await createWorkspaceMember(app.db, { role: "owner" });
    const target = await createTargetWorkspace();
    await addWorkspaceMember(app.db, target.id, owner.user.id, "owner");
    const { project } = await createProjectFixture(app.db, {
      workspaceId: owner.workspace.id,
    });

    app.auth.signIn(owner.user);
    const response = await move(project.id, target.id);

    expect(response.status).toBe(200);
    expect(realtime.closeProjectConnections).toHaveBeenCalledTimes(1);
    expect(realtime.closeProjectConnections).toHaveBeenCalledWith(project.id);
  });

  it.skip("relation creation waits for a moving project and rechecks the workspace (needs the task-relation area, not ported yet)", () => {});
});
