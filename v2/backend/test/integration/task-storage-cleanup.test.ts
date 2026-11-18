import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { AssetEntity } from "../../src/database/entities/asset.entity";
import { StorageCleanupEntity } from "../../src/database/entities/storage-cleanup.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { BulkUpdateService } from "../../src/task/mutations/bulk/bulk-update.service";
import { TaskDeletionService } from "../../src/task/mutations/task-deletion.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { insertRow } from "../support/fixtures/insert-row";
import { createUnseededWorkspaceMember } from "../support/fixtures/task-d-unseeded-member";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from the previous `project-storage-cleanup` suite: the task
// deletion cases. Deleting the stored objects (`retryStorageCleanup`) belongs
// to the storage feature, so these stop at the queued cleanup rows.
let app: TestApp;
let deletion: TaskDeletionService;
let bulk: BulkUpdateService;

beforeAll(async () => {
  app = await createTestApp();
  deletion = app.get(TaskDeletionService);
  bulk = app.get(BulkUpdateService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
});

async function seedTaskWithAttachment(title: string, objectKey: string) {
  const { workspace, user } = await createUnseededWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title,
    status: "to-do",
  });
  await insertRow(app.db, AssetEntity, {
    taskId: task.id,
    projectId: project.id,
    workspaceId: workspace.id,
    objectKey,
    filename: "test.png",
    mimeType: "image/png",
    size: 1,
    createdBy: user.id,
  });
  return { workspace, user, project, task };
}

function deleteTask(mode: string, taskId: string, userId: string) {
  return mode === "single"
    ? deletion.deleteTask(taskId, userId)
    : bulk.bulkUpdateTasks({
        taskIds: [taskId],
        operation: "delete",
        userId,
      });
}

it.each(["single", "bulk"])(
  "queues attachments for cleanup after %s task deletion",
  async (mode) => {
    const { user, task } = await seedTaskWithAttachment(
      "delete attachment",
      "task-attachment",
    );

    await deleteTask(mode, task.id, user.id);

    expect(
      await app.db.findOne(TaskEntity, { where: { id: task.id } }),
    ).toBeNull();
    expect(await app.db.find(StorageCleanupEntity)).toEqual([
      expect.objectContaining({ objectKey: "task-attachment" }),
    ]);
  },
);

it.each(["single", "bulk"])(
  "rejects %s deletion when a task moves after its authorized read",
  async (mode) => {
    const { user, task } = await seedTaskWithAttachment(
      "Moved attachment",
      "moved-attachment",
    );
    const foreign = await createUnseededWorkspaceMember(app.db);
    const destination = await createProjectFixture(app.db, {
      workspaceId: foreign.workspace.id,
    });

    const transaction = app.dataSource.transaction.bind(app.dataSource);
    vi.spyOn(app.dataSource, "transaction").mockImplementationOnce((async (
      ...args: Parameters<DataSource["transaction"]>
    ) => {
      await app.db.update(
        TaskEntity,
        { id: task.id },
        { projectId: destination.project.id },
      );
      await app.db.update(
        AssetEntity,
        { taskId: task.id },
        {
          projectId: destination.project.id,
          workspaceId: foreign.workspace.id,
        },
      );
      return (transaction as (...a: unknown[]) => Promise<unknown>)(...args);
    }) as DataSource["transaction"]);

    await expect(deleteTask(mode, task.id, user.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await app.db.find(TaskEntity, { where: { id: task.id } }),
    ).toHaveLength(1);
    expect(
      await app.db.find(AssetEntity, { where: { taskId: task.id } }),
    ).toHaveLength(1);
    expect(await app.db.find(StorageCleanupEntity)).toHaveLength(0);
  },
);
