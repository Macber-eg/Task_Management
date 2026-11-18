import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApikeyEntity } from "../../src/database/entities/apikey.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { WorkspaceMemberAccessEntity } from "../../src/database/entities/workspace-member-access.entity";
import { WorkspaceMemberProjectEntity } from "../../src/database/entities/workspace-member-project.entity";
import { EventBus } from "../../src/events/event-bus";
import { LabelIntegrationSync } from "../../src/label/label-integration-sync";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import {
  createLabelIntegrationSyncDouble,
  resetLabelIntegrationSyncDouble,
} from "../support/label-integration-sync-double";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Not ported from the previous suite, which had no HTTP coverage for these
// routes: they pin the translated queries and the route wiring.
describe("API integration: label routes", () => {
  const sync = createLabelIntegrationSyncDouble();
  const createdEvents: unknown[] = [];
  let app: TestApp;

  function json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  async function ids(response: Response) {
    const labels = (await response.json()) as { id: string }[];
    return labels.map((label) => label.id).sort();
  }

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[LabelIntegrationSync, sync]] });
    app.get(EventBus).subscribe("task.label_created", async (data) => {
      createdEvents.push(data);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    resetLabelIntegrationSyncDouble(sync);
    createdEvents.length = 0;
  });

  it("lists a task's labels and answers 404 for an unknown task", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    const other = await createTask(app.db, {
      projectId: project.id,
      number: 2,
    });
    const label = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: task.id,
      name: "Bug",
    });
    await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: other.id,
      name: "Bug",
    });
    app.auth.signIn(user);

    const response = await app.request(`/api/label/task/${task.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: label.id,
        name: "Bug",
        color: "#ef4444",
        createdAt: label.createdAt.toISOString(),
        updatedAt: label.updatedAt.toISOString(),
        deletionStartedAt: null,
        taskId: task.id,
        workspaceId: workspace.id,
      },
    ]);

    const missing = await app.request("/api/label/task/missing");
    expect(missing.status).toBe(404);
    expect(await readErrorBody(missing)).toEqual({
      message: "Task not found",
      code: "NOT_FOUND",
    });
  });

  it("lists workspace labels without task labels from projects the member cannot see", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project: open } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const { project: hidden } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const openTask = await createTask(app.db, { projectId: open.id });
    const hiddenTask = await createTask(app.db, { projectId: hidden.id });
    const root = await createLabel(app.db, {
      workspaceId: workspace.id,
      name: "Bug",
    });
    const visible = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: openTask.id,
      name: "Bug",
    });
    const concealed = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: hiddenTask.id,
      name: "Bug",
    });
    const foreign = await createWorkspaceMember(app.db);
    await createLabel(app.db, { workspaceId: foreign.workspace.id, name: "X" });
    app.auth.signIn(user);

    const all = await app.request(`/api/label/workspace/${workspace.id}`);
    expect(all.status).toBe(200);
    expect(await ids(all)).toEqual([root.id, visible.id, concealed.id].sort());

    await insertRow(app.db, WorkspaceMemberAccessEntity, {
      workspaceId: workspace.id,
      userId: user.id,
      projectAccess: "selected",
    });
    await insertRow(app.db, WorkspaceMemberProjectEntity, {
      workspaceId: workspace.id,
      userId: user.id,
      projectId: open.id,
    });

    const restricted = await app.request(
      `/api/label/workspace/${workspace.id}`,
    );
    expect(restricted.status).toBe(200);
    expect(await ids(restricted)).toEqual([root.id, visible.id].sort());

    const hiddenLabel = await app.request(`/api/label/${concealed.id}`);
    expect(hiddenLabel.status).toBe(403);
    expect(await readErrorBody(hiddenLabel)).toEqual({
      message: "You don't have access to this project",
      code: "FORBIDDEN",
    });
  });

  it("reads one label and answers 404 for an unknown one", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const label = await createLabel(app.db, {
      workspaceId: workspace.id,
      name: "Bug",
    });
    app.auth.signIn(user);

    const response = await app.request(`/api/label/${label.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: label.id,
      name: "Bug",
      taskId: null,
      workspaceId: workspace.id,
    });

    const missing = await app.request("/api/label/missing");
    expect(missing.status).toBe(404);
    expect(await readErrorBody(missing)).toEqual({
      message: "Label not found",
      code: "NOT_FOUND",
    });
  });

  it("renames a workspace label together with its task copies", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    const root = await createLabel(app.db, {
      workspaceId: workspace.id,
      name: "Bug",
    });
    const copy = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: task.id,
      name: "Bug",
    });
    const untouched = await createLabel(app.db, {
      workspaceId: workspace.id,
      name: "Feature",
    });
    app.auth.signIn(user);

    const response = await app.request(
      `/api/label/${root.id}`,
      json("PUT", { name: "Defect", color: "#123456" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: root.id,
      name: "Defect",
      color: "#123456",
      taskId: null,
    });

    const stored = await app.db.findOneOrFail(LabelEntity, {
      where: { id: copy.id },
    });
    expect(stored).toMatchObject({ name: "Defect", color: "#123456" });
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(
      copy.updatedAt.getTime(),
    );
    expect(
      await app.db.findOne(LabelEntity, { where: { id: untouched.id } }),
    ).toEqual(untouched);
    expect(sync.notifySyncWorkspaceLabelChanged.mock.calls).toEqual([
      [workspace.id, root.id, { publishProjectUpdates: false }],
    ]);
  });

  it("creates a task label once, syncing and announcing only the first time", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    app.auth.signIn(user);
    const body = {
      name: "Bug",
      color: "#ef4444",
      workspaceId: workspace.id,
      taskId: task.id,
    };

    const first = await app.request("/api/label", json("POST", body));
    expect(first.status).toBe(200);
    const created = (await first.json()) as { id: string; taskId: string };
    expect(created.taskId).toBe(task.id);

    const second = await app.request("/api/label", json("POST", body));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { id: string }).id).toBe(created.id);

    expect(
      await app.db.count(LabelEntity, { where: { workspaceId: workspace.id } }),
    ).toBe(1);
    expect(sync.syncLabelToGitHub.mock.calls).toEqual([
      [task.id, "Bug", "#ef4444"],
    ]);
    expect(sync.syncLabelToGitea).toHaveBeenCalledTimes(1);
    expect(sync.syncLabelToGitlab).toHaveBeenCalledTimes(1);
    expect(createdEvents).toEqual([
      {
        projectId: project.id,
        taskId: task.id,
        userId: user.id,
        type: "label_created",
        initiatorId: user.id,
      },
    ]);
  });

  it("answers 404 when the task named on creation is in another workspace", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const foreign = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: foreign.workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    app.auth.signIn(user);

    const response = await app.request(
      "/api/label",
      json("POST", {
        name: "Bug",
        color: "#ef4444",
        workspaceId: workspace.id,
        taskId: task.id,
      }),
    );
    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toEqual({
      message: "Task not found",
      code: "NOT_FOUND",
    });
  });

  it("refuses a viewer with the missing permission, before validating the body", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "viewer",
    });
    app.auth.signIn(user);

    const response = await app.request(
      "/api/label",
      json("POST", { workspaceId: workspace.id }),
    );
    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toEqual({
      message: "Insufficient permissions",
      code: "MISSING_PERMISSION",
      missingPermissions: ["label:create"],
    });
  });

  it("lets a member delete a task label and refuses a viewer", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const viewer = await createUser(app.db);
    await addWorkspaceMember(app.db, workspace.id, viewer.id, "viewer");
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    const label = await createLabel(app.db, {
      workspaceId: workspace.id,
      taskId: task.id,
      name: "scratch",
    });

    app.auth.signIn(viewer);
    const refused = await app.request(`/api/label/${label.id}`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(403);
    expect(await readErrorBody(refused)).toEqual({
      message: "Insufficient permissions",
      code: "MISSING_PERMISSION",
      missingPermissions: ["label:delete"],
    });

    app.auth.signIn(user);
    const deleted = await app.request(`/api/label/${label.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      id: label.id,
      taskId: task.id,
    });
    expect(await app.db.count(LabelEntity)).toBe(0);
    expect(sync.removeLabelFromGitHub.mock.calls).toEqual([
      [task.id, "scratch"],
    ]);
  });

  it("reports an invalid body in the API error shape", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    app.auth.signIn(user);

    const response = await app.request(
      "/api/label",
      json("POST", { workspaceId: workspace.id, color: "#ef4444" }),
    );
    expect(response.status).toBe(400);
    const body = await readErrorBody(response);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toMatch(/^name: /);
    expect(body.issues?.map((issue) => issue.path)).toEqual(["body.name"]);
  });

  it("holds an API key to its scope", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const now = new Date();
    const apiKey = await insertRow(app.db, ApikeyEntity, {
      referenceId: user.id,
      userId: user.id,
      key: "hashed-test-key",
      createdAt: now,
      updatedAt: now,
    });
    app.auth.signInAs({
      userId: user.id,
      userEmail: "",
      user: null,
      session: null,
      apiKey: {
        id: apiKey.id,
        userId: user.id,
        enabled: true,
        permissions: { label: ["read"] },
      },
    });

    const response = await app.request(
      "/api/label",
      json("POST", {
        name: "Bug",
        color: "#ef4444",
        workspaceId: workspace.id,
      }),
    );
    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toEqual({
      message: "Insufficient API key scope",
      code: "API_KEY_SCOPE",
      missingPermissions: ["label:create"],
    });
    expect(await app.db.count(LabelEntity)).toBe(0);
  });
});
