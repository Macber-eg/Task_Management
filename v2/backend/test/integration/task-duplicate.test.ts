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
import { AssetEntity } from "../../src/database/entities/asset.entity";
import { CustomFieldDefinitionEntity } from "../../src/database/entities/custom-field-definition.entity";
import { CustomFieldValueEntity } from "../../src/database/entities/custom-field-value.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { TaskAssetStorage } from "../../src/task/seams/task-asset-storage";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { seedCountedTask } from "../support/fixtures/task-c-seed-task";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const DUPLICATED_OBJECT_KEY =
  "workspace/ws/project/pj/task/copy/descriptions/diagram-1-copy.png";

// Stands in for S3, as the previous tests mocked `copyTaskAssetObject` and
// `deleteS3Object`.
const storage = {
  copyTaskAssetObject: vi.fn<TaskAssetStorage["copyTaskAssetObject"]>(),
  deleteObject: vi.fn<TaskAssetStorage["deleteObject"]>(),
  deleteOrphanedAssets: vi.fn<TaskAssetStorage["deleteOrphanedAssets"]>(),
} satisfies TaskAssetStorage;

let app: TestApp;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp({ overrides: [[TaskAssetStorage, storage]] });
  publish = vi.spyOn(app.get(EventBus), "publish");
});

afterAll(async () => {
  await app.close();
});

function seedTask(options: Parameters<typeof seedCountedTask>[1]) {
  return seedCountedTask(app.db, options);
}

function requestDuplicate(taskId: string, body: { title?: string } = {}) {
  return app.request(`/api/task/duplicate/${taskId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function tasksOf(projectId?: string) {
  return app.db.find(TaskEntity, projectId ? { where: { projectId } } : {});
}

describe("API integration: task duplication", () => {
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    publish.mockReset().mockResolvedValue(undefined);
    storage.copyTaskAssetObject
      .mockReset()
      .mockImplementation(async () => DUPLICATED_OBJECT_KEY);
    storage.deleteObject.mockReset().mockResolvedValue(undefined);
    storage.deleteOrphanedAssets.mockReset().mockResolvedValue(undefined);
  });

  it("rejects unauthenticated task duplication requests", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
    });

    app.auth.signOut();
    const response = await requestDuplicate(task.id);

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("blocks a viewer from duplicating a task (viewer role lacks task:create)", async () => {
    const viewer = await createWorkspaceMember(app.db, { role: "viewer" });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: viewer.workspace.id,
    });
    const task = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
    });

    app.auth.signIn(viewer.user);
    const response = await requestDuplicate(task.id);

    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toEqual({
      message: "Insufficient permissions",
      code: "MISSING_PERMISSION",
      missingPermissions: ["task:create"],
    });
    expect(await tasksOf(project.id)).toHaveLength(1);
  });

  it("rejects duplication for users outside the project workspace", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
    });
    const outsider = await createUser(app.db, {
      id: `user-${randomUUID()}`,
      name: "Duplicate Outsider",
    });

    app.auth.signIn(outsider);
    const response = await requestDuplicate(task.id);

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Task not found",
      code: "NOT_FOUND",
    });
    expect(await tasksOf(project.id)).toHaveLength(1);
  });

  it("copies the task fields and labels into a new task at the end of the column", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask({
      projectId: project.id,
      columnId: columns.inProgress.id,
      userId: member.user.id,
      overrides: {
        status: "in-progress",
        startDate: new Date("2026-04-01T09:00:00.000Z"),
        dueDate: new Date("2026-04-05T17:00:00.000Z"),
      },
    });
    await createLabel(app.db, {
      name: "backend",
      color: "#FF6600",
      taskId: task.id,
      workspaceId: member.workspace.id,
    });
    await createLabel(app.db, {
      name: "release",
      color: "#00AAFF",
      taskId: task.id,
      workspaceId: member.workspace.id,
    });

    app.auth.signIn(member.user);
    const response = await requestDuplicate(task.id, {
      title: "Release checklist (copy)",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      title: string;
      number: number | null;
      position: number | null;
      assigneeName?: string;
    };

    expect(payload.id).not.toBe(task.id);
    expect(payload).toMatchObject({
      title: "Release checklist (copy)",
      number: 2,
      position: 2,
      assigneeName: member.user.name,
    });

    const duplicatedTask = await app.db.findOne(TaskEntity, {
      where: { id: payload.id },
    });
    expect(duplicatedTask).toMatchObject({
      projectId: project.id,
      columnId: columns.inProgress.id,
      userId: member.user.id,
      title: "Release checklist (copy)",
      description: task.description,
      status: "in-progress",
      priority: "high",
      number: 2,
      position: 2,
    });
    expect(duplicatedTask?.startDate?.toISOString()).toBe(
      "2026-04-01T09:00:00.000Z",
    );
    expect(duplicatedTask?.dueDate?.toISOString()).toBe(
      "2026-04-05T17:00:00.000Z",
    );

    const duplicatedLabels = await app.db.find(LabelEntity, {
      where: { taskId: payload.id },
      select: { name: true, color: true, workspaceId: true },
    });
    expect(
      duplicatedLabels.map(({ name, color, workspaceId }) => ({
        name,
        color,
        workspaceId,
      })),
    ).toEqual(
      expect.arrayContaining([
        { name: "backend", color: "#FF6600", workspaceId: member.workspace.id },
        { name: "release", color: "#00AAFF", workspaceId: member.workspace.id },
      ]),
    );
    expect(duplicatedLabels).toHaveLength(2);

    expect(
      await app.db.findOne(TaskEntity, { where: { id: task.id } }),
    ).toMatchObject({ title: "Release checklist", number: 1, position: 1 });
  });

  it("keeps a duplicated subtask under the same parent without copying its own subtasks", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const parent = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
      overrides: { title: "Release epic", number: 1, position: 1 },
    });
    const subtask = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
      overrides: { title: "Bump version", number: 2, position: 2 },
    });
    const grandchild = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
      overrides: { title: "Update changelog", number: 3, position: 3 },
    });
    await insertRow(app.db, TaskRelationEntity, {
      sourceTaskId: parent.id,
      targetTaskId: subtask.id,
      relationType: "subtask",
    });
    await insertRow(app.db, TaskRelationEntity, {
      sourceTaskId: subtask.id,
      targetTaskId: grandchild.id,
      relationType: "subtask",
    });

    app.auth.signIn(member.user);
    const response = await requestDuplicate(subtask.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string };

    const parentsOfCopy = await app.db.find(TaskRelationEntity, {
      where: { targetTaskId: payload.id },
    });
    expect(
      parentsOfCopy.map(({ sourceTaskId, relationType }) => ({
        sourceTaskId,
        relationType,
      })),
    ).toEqual([{ sourceTaskId: parent.id, relationType: "subtask" }]);

    expect(
      await app.db.find(TaskRelationEntity, {
        where: { sourceTaskId: payload.id },
      }),
    ).toEqual([]);
  });

  it.each(["custom-role", "api-key"] as const)(
    "%s cannot copy parent links without task:update but can copy standalone tasks",
    async (authentication) => {
      const member = await createWorkspaceMember(app.db, {
        role: authentication === "custom-role" ? "creator" : "admin",
      });
      const { project, columns } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const parent = await seedTask({
        projectId: project.id,
        columnId: columns.todo.id,
      });
      const child = await seedTask({
        projectId: project.id,
        columnId: columns.todo.id,
        overrides: { number: 2 },
      });
      await insertRow(app.db, TaskRelationEntity, {
        sourceTaskId: parent.id,
        targetTaskId: child.id,
        relationType: "subtask",
      });
      const permissions = { task: ["create", "read"] };
      if (authentication === "custom-role") {
        await addWorkspaceRole(
          app.db,
          member.workspace.id,
          "creator",
          permissions,
        );
        app.auth.signIn(member.user);
      } else {
        app.auth.signInAs(
          await createApiKeyPrincipal(app.db, member.user, permissions),
        );
      }
      const rejected = await requestDuplicate(child.id);
      expect(rejected.status).toBe(403);
      expect(await tasksOf()).toHaveLength(2);
      expect(await app.db.find(TaskRelationEntity)).toHaveLength(1);
      expect(storage.copyTaskAssetObject).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect((await requestDuplicate(parent.id)).status).toBe(200);
    },
  );

  it("copies the description assets and repoints the copy at them", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const sourceAssetId = "asset1sourcekey000000001";
    const task = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
      overrides: {
        description: `<p>Before</p><img src="http://localhost:1337/api/asset/${sourceAssetId}" alt="Diagram" /><p>After</p>`,
      },
    });
    await insertRow(app.db, AssetEntity, {
      id: sourceAssetId,
      workspaceId: member.workspace.id,
      projectId: project.id,
      taskId: task.id,
      objectKey:
        "workspace/ws/project/pj/task/source/descriptions/diagram-1.png",
      filename: "diagram-1.png",
      mimeType: "image/png",
      size: 2048,
      kind: "image",
      surface: "description",
      createdBy: member.user.id,
    });

    app.auth.signIn(member.user);
    const response = await requestDuplicate(task.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      description: string;
    };

    expect(storage.copyTaskAssetObject).toHaveBeenCalledTimes(1);
    expect(storage.copyTaskAssetObject).toHaveBeenCalledWith({
      sourceKey:
        "workspace/ws/project/pj/task/source/descriptions/diagram-1.png",
      destination: {
        workspaceId: member.workspace.id,
        projectId: project.id,
        taskId: payload.id,
        surface: "description",
        filename: "diagram-1.png",
        contentType: "image/png",
      },
    });

    const [duplicatedAsset] = await app.db.find(AssetEntity, {
      where: { taskId: payload.id },
    });
    expect(duplicatedAsset).toMatchObject({
      workspaceId: member.workspace.id,
      projectId: project.id,
      objectKey: DUPLICATED_OBJECT_KEY,
      filename: "diagram-1.png",
      mimeType: "image/png",
      size: 2048,
      kind: "image",
      surface: "description",
      createdBy: member.user.id,
    });
    expect(duplicatedAsset?.id).not.toBe(sourceAssetId);

    expect(payload.description).toContain(`/api/asset/${duplicatedAsset?.id}`);
    expect(payload.description).not.toContain(sourceAssetId);

    const sourceTask = await app.db.findOne(TaskEntity, {
      where: { id: task.id },
    });
    expect(sourceTask?.description).toContain(`/api/asset/${sourceAssetId}`);
  });

  it("keeps the source title when no title override is provided", async () => {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
    });

    app.auth.signIn(member.user);
    const response = await requestDuplicate(task.id);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; title: string };
    expect(payload.title).toBe("Release checklist");

    const duplicatedTask = await app.db.findOne(TaskEntity, {
      where: { id: payload.id, projectId: project.id },
    });
    expect(duplicatedTask?.title).toBe("Release checklist");
  });

  async function fixture() {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const task = await seedTask({
      projectId: project.id,
      columnId: columns.todo.id,
    });
    app.auth.signIn(member.user);
    return { ...member, project, columns, task };
  }

  function addField(values: Partial<CustomFieldDefinitionEntity>) {
    return insertRow(app.db, CustomFieldDefinitionEntity, values);
  }

  function addFieldValue(values: Partial<CustomFieldValueEntity>) {
    return insertRow(app.db, CustomFieldValueEntity, values);
  }

  it("copies project custom fields and fills missing required defaults", async () => {
    const own = await fixture();
    const definitions = [
      await addField({
        projectId: own.project.id,
        name: "Estimate",
        type: "number",
        required: true,
      }),
      await addField({
        projectId: own.project.id,
        name: "Approved",
        type: "boolean",
      }),
      await addField({ projectId: own.project.id, name: "Note", type: "text" }),
      await addField({
        projectId: own.project.id,
        name: "Category",
        type: "dropdown",
        required: true,
        defaultValue: "Work",
        options: ["Work", "Personal"],
      }),
    ];
    await addFieldValue({
      taskId: own.task.id,
      fieldId: definitions[0]!.id,
      value: "5",
    });
    await addFieldValue({
      taskId: own.task.id,
      fieldId: definitions[1]!.id,
      value: "false",
    });
    await addFieldValue({
      taskId: own.task.id,
      fieldId: definitions[2]!.id,
      value: null,
    });
    const { project: otherProject } = await createProjectFixture(app.db, {
      workspaceId: own.workspace.id,
    });
    const foreignField = await addField({
      projectId: otherProject.id,
      name: "Foreign",
      type: "text",
    });
    await addFieldValue({
      taskId: own.task.id,
      fieldId: foreignField.id,
      value: "do not copy",
    });

    const response = await requestDuplicate(own.task.id);
    expect(response.status).toBe(200);
    const copy = (await response.json()) as { id: string };
    const values = await app.db.find(CustomFieldValueEntity, {
      where: { taskId: copy.id },
    });
    expect(new Map(values.map((v) => [v.fieldId, v.value]))).toEqual(
      new Map([
        [definitions[0]!.id, "5"],
        [definitions[1]!.id, "false"],
        [definitions[2]!.id, ""],
        [definitions[3]!.id, "Work"],
      ]),
    );
    await app.db.delete(TaskEntity, { id: own.task.id });
    expect(
      await app.db.find(CustomFieldValueEntity, { where: { taskId: copy.id } }),
    ).toHaveLength(4);
  });

  it("rejects missing required fields before creating a task or copying storage", async () => {
    const own = await fixture();
    await addField({
      projectId: own.project.id,
      name: "Required",
      type: "text",
      required: true,
    });
    const response = await requestDuplicate(own.task.id);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("required");
    expect(await tasksOf()).toHaveLength(1);
    expect(storage.copyTaskAssetObject).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects an obsolete custom-field dropdown value", async () => {
    const own = await fixture();
    const field = await addField({
      projectId: own.project.id,
      name: "Category",
      type: "dropdown",
      options: ["new"],
    });
    await addFieldValue({
      taskId: own.task.id,
      fieldId: field.id,
      value: "old",
    });
    expect((await requestDuplicate(own.task.id)).status).toBe(400);
    expect(await tasksOf()).toHaveLength(1);
  });

  it("copies only same-workspace parents and labels from legacy mixed data", async () => {
    const own = await fixture();
    const other = await createWorkspaceMember(app.db);
    const { project: foreignProject, columns: foreignColumns } =
      await createProjectFixture(app.db, { workspaceId: other.workspace.id });
    const foreignParent = await seedTask({
      projectId: foreignProject.id,
      columnId: foreignColumns.todo.id,
    });
    const { project: siblingProject, columns: siblingColumns } =
      await createProjectFixture(app.db, { workspaceId: own.workspace.id });
    const parent = await seedTask({
      projectId: siblingProject.id,
      columnId: siblingColumns.todo.id,
    });
    for (const p of [parent, foreignParent]) {
      await insertRow(app.db, TaskRelationEntity, {
        sourceTaskId: p.id,
        targetTaskId: own.task.id,
        relationType: "subtask",
      });
    }
    await createLabel(app.db, {
      taskId: own.task.id,
      workspaceId: own.workspace.id,
      name: "Local",
      color: "blue",
    });
    await createLabel(app.db, {
      taskId: own.task.id,
      workspaceId: other.workspace.id,
      name: "Foreign",
      color: "red",
    });

    const response = await requestDuplicate(own.task.id);
    expect(response.status).toBe(200);
    const copy = (await response.json()) as { id: string };
    expect(
      await app.db.find(TaskRelationEntity, {
        where: { targetTaskId: copy.id },
      }),
    ).toMatchObject([{ sourceTaskId: parent.id }]);
    const labels = await app.db.find(LabelEntity, {
      where: { taskId: copy.id },
    });
    expect(labels).toHaveLength(1);
    expect(labels[0]?.name).toBe("Local");
    const relationEvents = publish.mock.calls.filter(
      ([name]) => name === "task-relation.created",
    );
    expect(relationEvents).toHaveLength(1);
    expect(relationEvents[0]?.[1]).toMatchObject({
      sourceTaskId: parent.id,
      projectId: siblingProject.id,
    });
  });

  it("allocates distinct task numbers and positions for simultaneous copies", async () => {
    const own = await fixture();
    const responses = await Promise.all([
      requestDuplicate(own.task.id),
      requestDuplicate(own.task.id),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const copies = (await Promise.all(responses.map((r) => r.json()))) as {
      number: number;
      position: number;
    }[];
    expect(copies.map((c) => c.number).sort()).toEqual([2, 3]);
    expect(copies.map((c) => c.position).sort()).toEqual([2, 3]);
  });

  it("repairs a full position range before appending the copy", async () => {
    const own = await fixture();
    await app.db.update(
      TaskEntity,
      { id: own.task.id },
      { position: 2147483647 },
    );
    const response = await requestDuplicate(own.task.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ position: 2 });
  });

  it("does not carry a foreign assignee into a new task", async () => {
    const own = await fixture();
    const other = await createWorkspaceMember(app.db);
    await app.db.update(
      TaskEntity,
      { id: own.task.id },
      { userId: other.user.id },
    );
    expect((await requestDuplicate(own.task.id)).status).toBe(403);
    expect(await tasksOf()).toHaveLength(1);
  });

  it("cleans up partial asset copies and returns a safe error", async () => {
    const own = await fixture();
    const ids = ["firstasset", "secondasset"];
    await app.db.update(
      TaskEntity,
      { id: own.task.id },
      {
        description: ids.map((id) => `![Image](/api/asset/${id})`).join("\n"),
      },
    );
    for (const id of ids) {
      await insertRow(app.db, AssetEntity, {
        id,
        taskId: own.task.id,
        projectId: own.project.id,
        workspaceId: own.workspace.id,
        objectKey: id,
        filename: "image.png",
        mimeType: "image/png",
        size: 10,
        kind: "image",
        surface: "description",
        createdBy: own.user.id,
      });
    }
    storage.copyTaskAssetObject
      .mockResolvedValueOnce("copied-first")
      .mockRejectedValueOnce(new Error("private bucket details"));

    const response = await requestDuplicate(own.task.id);
    expect(response.status).toBe(503);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Failed to copy the task attachments",
      code: "SERVICE_UNAVAILABLE",
    });
    expect(storage.deleteObject).toHaveBeenCalledWith("copied-first");
    expect(await tasksOf()).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
  });
});
