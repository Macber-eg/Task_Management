import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { EventBus } from "../../src/events/event-bus";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type RecordedEvent = {
  type: string;
  data: unknown;
};

describe("API integration: label detach/attach", () => {
  let app: TestApp;
  const recordedEvents: RecordedEvent[] = [];

  function seedTask(userId: string, projectId: string) {
    return createTask(app.db, {
      projectId,
      userId,
      title: "Seed",
      status: "to-do",
      priority: "medium",
      number: 1,
      position: 1,
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    const events = app.get(EventBus);
    for (const type of ["task.label_assigned", "task.label_unassigned"]) {
      events.subscribe(type, async (data) => {
        recordedEvents.push({ type, data });
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    recordedEvents.length = 0;
  });

  it("allows a workspace definition and a task assignment with the same name to coexist", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(member.user.id, project.id);

    const workspaceLabel = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: null,
    });

    const taskCopy = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: task.id,
    });

    const allLabels = await app.db.find(LabelEntity, {
      where: { workspaceId: member.workspace.id },
    });
    expect(allLabels).toHaveLength(2);
    expect(workspaceLabel.taskId).toBeNull();
    expect(taskCopy.taskId).toBe(task.id);
  });

  it("attaches a label to a task without mutating the workspace definition", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(member.user.id, project.id);

    app.auth.signIn(member.user);

    const createResponse = await app.request("/api/label", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Feature",
        color: "#3b82f6",
        workspaceId: member.workspace.id,
      }),
    });
    expect(createResponse.status).toBe(200);
    const label = (await createResponse.json()) as {
      id: string;
      name: string;
      color: string;
    };

    const attachResponse = await app.request(`/api/label/${label.id}/task`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(attachResponse.status).toBe(200);

    const allLabels = await app.db.find(LabelEntity, {
      where: { workspaceId: member.workspace.id, name: "Feature" },
    });

    const workspaceLabel = allLabels.find((l) => l.taskId === null);
    const taskCopy = allLabels.find((l) => l.taskId === task.id);

    expect(workspaceLabel).toBeDefined();
    expect(taskCopy).toBeDefined();
    expect(workspaceLabel?.id).toBe(label.id);
    expect(workspaceLabel?.taskId).toBeNull();
    expect(taskCopy?.taskId).toBe(task.id);
  });

  it("makes repeated attachment idempotent without creating duplicates", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(member.user.id, project.id);

    const label = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: null,
    });

    app.auth.signIn(member.user);

    const first = await app.request(`/api/label/${label.id}/task`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(first.status).toBe(200);

    const second = await app.request(`/api/label/${label.id}/task`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(second.status).toBe(200);

    const allLabels = await app.db.find(LabelEntity, {
      where: { workspaceId: member.workspace.id, name: "Bug" },
    });
    expect(allLabels).toHaveLength(2);
    expect(allLabels.filter((l) => l.taskId === task.id)).toHaveLength(1);
  });

  it("does not republish task.label_assigned when re-attaching the same workspace label", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(member.user.id, project.id);

    const label = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: null,
    });

    app.auth.signIn(member.user);

    const first = await app.request(`/api/label/${label.id}/task`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(first.status).toBe(200);

    recordedEvents.length = 0;

    const second = await app.request(`/api/label/${label.id}/task`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(second.status).toBe(200);

    const assignedEvents = recordedEvents.filter(
      (e) => e.type === "task.label_assigned",
    );
    expect(assignedEvents).toHaveLength(0);
  });

  it("detaches a label by deleting the task assignment and leaves the workspace definition intact", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(member.user.id, project.id);

    const workspaceLabel = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: null,
    });

    const taskCopy = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: task.id,
    });

    app.auth.signIn(member.user);

    const detachResponse = await app.request(`/api/label/${taskCopy.id}/task`, {
      method: "DELETE",
    });
    expect(detachResponse.status).toBe(200);

    const remaining = await app.db.find(LabelEntity, {
      where: { workspaceId: member.workspace.id },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(workspaceLabel.id);
    expect(remaining[0]?.taskId).toBeNull();
  });

  it("does not violate label_workspace_name_unique after detachment", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(member.user.id, project.id);

    const workspaceLabel = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: null,
    });

    const taskCopy = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: task.id,
    });

    app.auth.signIn(member.user);

    const detachResponse = await app.request(`/api/label/${taskCopy.id}/task`, {
      method: "DELETE",
    });
    expect(detachResponse.status).toBe(200);

    const workspaceRows = await app.db.find(LabelEntity, {
      where: { workspaceId: member.workspace.id, name: "Bug" },
    });
    const workspaceDefinitions = workspaceRows.filter((l) => l.taskId === null);
    expect(workspaceDefinitions).toHaveLength(1);
    expect(workspaceDefinitions[0]?.id).toBe(workspaceLabel.id);

    await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: task.id,
    });

    const reattachedRows = await app.db.find(LabelEntity, {
      where: { workspaceId: member.workspace.id, name: "Bug" },
    });
    const reattachedTaskRows = reattachedRows.filter((l) => l.taskId !== null);
    const reattachedWorkspaceRows = reattachedRows.filter(
      (l) => l.taskId === null,
    );

    expect(reattachedTaskRows).toHaveLength(1);
    expect(reattachedTaskRows[0]?.taskId).toBe(task.id);
    expect(reattachedWorkspaceRows).toHaveLength(1);
    expect(reattachedWorkspaceRows[0]?.id).toBe(workspaceLabel.id);
  });

  it("emits task.label_assigned and task.label_unassigned events through detach/attach", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(member.user.id, project.id);

    const label = await createLabel(app.db, {
      name: "Bug",
      color: "#ef4444",
      workspaceId: member.workspace.id,
      taskId: null,
    });

    app.auth.signIn(member.user);

    const attachResponse = await app.request(`/api/label/${label.id}/task`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(attachResponse.status).toBe(200);
    const attachPayload = (await attachResponse.json()) as { id: string };

    const detachResponse = await app.request(
      `/api/label/${attachPayload.id}/task`,
      {
        method: "DELETE",
      },
    );
    expect(detachResponse.status).toBe(200);

    const assignedEvents = recordedEvents.filter(
      (e) => e.type === "task.label_assigned",
    );
    const unassignedEvents = recordedEvents.filter(
      (e) => e.type === "task.label_unassigned",
    );

    expect(assignedEvents).toHaveLength(1);
    expect(unassignedEvents).toHaveLength(1);

    const assignedPayload = assignedEvents[0]?.data as {
      taskId: string;
      label: { id: string; name: string };
      task: { id: string };
      projectId: string;
      userId: string;
      type: string;
    };
    expect(assignedPayload.taskId).toBe(task.id);
    expect(assignedPayload.task.id).toBe(task.id);
    expect(assignedPayload.label.name).toBe("Bug");
    expect(assignedPayload.userId).toBe(member.user.id);
    expect(assignedPayload.type).toBe("label_assigned");

    const unassignedPayload = unassignedEvents[0]?.data as {
      taskId: string;
      label: { id: string; name: string };
      task: { id: string };
      projectId: string;
      userId: string;
      type: string;
    };
    expect(unassignedPayload.taskId).toBe(task.id);
    expect(unassignedPayload.label.id).toBe(attachPayload.id);
    expect(unassignedPayload.label.name).toBe("Bug");
    expect(unassignedPayload.type).toBe("label_unassigned");
  });

  it.skip("bulk removeLabel deletes task-level copies without touching the workspace definition or unrelated labels (needs PATCH /api/task/bulk, which is not ported yet)", () => {});
});
