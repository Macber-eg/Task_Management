import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AssetEntity } from "../../src/database/entities/asset.entity";
import { CommentEntity } from "../../src/database/entities/comment.entity";
import { JobLeaseEntity } from "../../src/database/entities/job-lease.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { StorageCleanupEntity } from "../../src/database/entities/storage-cleanup.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { DraftUploadCleanup } from "../../src/storage/cleanup/draft-upload-cleanup.service";
import { OrphanedAssetCleanup } from "../../src/storage/cleanup/orphaned-asset-cleanup.service";
import { StorageCleanupQueue } from "../../src/storage/cleanup/storage-cleanup-queue.service";
import { StorageObjectLock } from "../../src/storage/cleanup/storage-object-lock";
import { ObjectStore } from "../../src/storage/object-store/object-store";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { InMemoryObjectStore } from "../support/in-memory-object-store";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/project-storage-cleanup.test.ts and the
// expiry case of staged-task-attachments.test.ts. Deletions go through SQL
// here: the delete triggers are what is under test, and the task and
// project delete routes belong to their own modules.
describe("storage cleanup", () => {
  const store = new InMemoryObjectStore();
  let app: TestApp;
  let queue: StorageCleanupQueue;
  let lock: StorageObjectLock;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[ObjectStore, store]] });
    queue = app.get(StorageCleanupQueue);
    lock = app.get(StorageObjectLock);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    store.reset();
    vi.restoreAllMocks();
  });

  async function queuedKeys() {
    return (await app.db.find(StorageCleanupEntity))
      .map((row) => row.objectKey)
      .sort();
  }

  async function seedProjectWithStorage(prefix: string) {
    const { workspace, user } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    await app.db.update(
      ProjectEntity,
      { id: project.id },
      { backgroundObjectKey: `${prefix}-background` },
    );
    await insertRow(app.db, AssetEntity, {
      projectId: project.id,
      workspaceId: workspace.id,
      objectKey: `${prefix}-attachment`,
      filename: "test.png",
      mimeType: "image/png",
      size: 1,
      createdBy: user.id,
    });
    return { workspace, user, project };
  }

  it("keeps attachment and background keys after cascading project deletion until storage recovers", async () => {
    const { project } = await seedProjectWithStorage("synthetic");
    const remove = vi
      .spyOn(store, "delete")
      .mockRejectedValue(new Error("storage offline"));

    await app.db.delete(ProjectEntity, { id: project.id });

    expect(await app.db.find(AssetEntity)).toEqual([]);
    expect(await queuedKeys()).toEqual([
      "synthetic-attachment",
      "synthetic-background",
    ]);
    expect(remove).not.toHaveBeenCalled();
    expect(await queue.processCleanupQueue()).toEqual({ degraded: true });
    expect(await queuedKeys()).toHaveLength(2);
    remove.mockResolvedValue(undefined);
    expect(await queue.processCleanupQueue()).toEqual({ degraded: false });
    expect(await queuedKeys()).toEqual([]);
  });

  it("captures storage keys when deleting the workspace through a parent cascade", async () => {
    const { workspace } = await seedProjectWithStorage("parent");

    await app.db.query("DELETE FROM workspace WHERE id = $1", [workspace.id]);

    expect(await queuedKeys()).toEqual([
      "parent-attachment",
      "parent-background",
    ]);
  });

  it("recovers queued attachments after task deletion", async () => {
    const { workspace, user } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    await insertRow(app.db, AssetEntity, {
      taskId: task.id,
      projectId: project.id,
      workspaceId: workspace.id,
      objectKey: "task-attachment",
      filename: "test.png",
      mimeType: "image/png",
      size: 1,
      createdBy: user.id,
    });
    const remove = vi
      .spyOn(store, "delete")
      .mockRejectedValue(new Error("offline"));

    await app.db.delete(TaskEntity, { id: task.id });

    expect(remove).not.toHaveBeenCalled();
    await queue.processCleanupQueue();
    expect(await queuedKeys()).toEqual(["task-attachment"]);
    remove.mockResolvedValue(undefined);
    await queue.processCleanupQueue();
    expect(await queuedKeys()).toEqual([]);
  });

  it("does not let a batch of failing objects starve later cleanup", async () => {
    for (let i = 0; i < 101; i++) {
      await insertRow(app.db, StorageCleanupEntity, {
        objectKey: `synthetic-${i}`,
        createdAt: new Date(Date.now() - (101 - i) * 1000),
      });
    }
    const remove = vi.spyOn(store, "delete").mockImplementation(async (key) => {
      if (key !== "synthetic-100") throw new Error("permanent storage failure");
    });

    await queue.processCleanupQueue();
    await queue.processCleanupQueue();

    expect(remove).toHaveBeenCalledWith("synthetic-100");
    expect(await queuedKeys()).not.toContain("synthetic-100");
  });

  it("retries failed objects even with a continuous backlog of new keys", async () => {
    await insertRow(app.db, StorageCleanupEntity, {
      objectKey: "old-failure",
      createdAt: new Date(0),
      lastAttemptAt: new Date(1),
    });
    await queue.queue(
      app.db,
      Array.from({ length: 100 }, (_, i) => `new-${i}`),
    );
    const remove = vi
      .spyOn(store, "delete")
      .mockRejectedValue(new Error("offline"));

    await queue.processCleanupQueue();

    expect(remove).toHaveBeenCalledWith("old-failure");
  });

  it("gives new objects a turn despite a full batch of permanent retries", async () => {
    for (let index = 0; index < 100; index++) {
      await insertRow(app.db, StorageCleanupEntity, {
        objectKey: `failure-${index}`,
        createdAt: new Date(0),
        lastAttemptAt: new Date(1),
      });
    }
    await insertRow(app.db, StorageCleanupEntity, {
      objectKey: "new-object",
      createdAt: new Date(2),
    });
    const remove = vi.spyOn(store, "delete").mockImplementation(async (key) => {
      if (key !== "new-object") throw new Error("offline");
    });

    await queue.processCleanupQueue();

    expect(remove).toHaveBeenCalledWith("new-object");
    expect(await queuedKeys()).not.toContain("new-object");
  });

  it("does not delete an object referenced by a live asset", async () => {
    const { workspace, user } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    await queue.queue(app.db, ["reused-live-key"]);
    await insertRow(app.db, AssetEntity, {
      projectId: project.id,
      workspaceId: workspace.id,
      objectKey: "reused-live-key",
      filename: "test.png",
      mimeType: "image/png",
      size: 1,
      createdBy: user.id,
    });
    const remove = vi.spyOn(store, "delete");

    await queue.processCleanupQueue();

    expect(remove).not.toHaveBeenCalled();
    expect(await app.db.find(AssetEntity)).toHaveLength(1);
    expect(await queuedKeys()).toEqual([]);
  });

  it("queues more than the PostgreSQL parameter limit without rolling back", async () => {
    await app.dataSource.transaction((manager) =>
      queue.queue(
        manager,
        Array.from({ length: 66_000 }, (_, i) => `large-project-${i}`),
      ),
    );

    const [count] = (await app.db.query(
      "SELECT count(*)::integer AS total FROM storage_cleanup",
    )) as { total: number }[];
    expect(count?.total).toBe(66_000);
  });

  it("keeps the pool available and protects objects during slow verification", async () => {
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let started = 0;
    let allStarted!: () => void;
    const ready = new Promise<void>((resolve) => {
      allStarted = resolve;
    });
    const pending = Array.from({ length: 10 }, (_, i) =>
      lock.withVerifiedObject(
        `slow-${i}`,
        async () => {
          if (++started === 10) allStarted();
          await wait;
          return i;
        },
        async (_manager, value) => value,
      ),
    );
    const remove = vi.spyOn(store, "delete");
    try {
      await ready;
      expect(await app.db.query("SELECT 1 AS healthy")).toEqual([
        { healthy: 1 },
      ]);
      await queue.queue(app.db, ["slow-0"]);
      await queue.processCleanupQueue();
      expect(remove).not.toHaveBeenCalled();
      expect(await queuedKeys()).toEqual(["slow-0"]);
    } finally {
      finish();
      await Promise.all(pending);
    }
    expect(await app.db.find(JobLeaseEntity)).toEqual([]);
  });

  it("declines to finalize after a verification lease expires", async () => {
    const apply = vi.fn();

    await expect(
      lock.withVerifiedObject(
        "expired",
        async () => {
          await app.db.update(
            JobLeaseEntity,
            { name: "storage-verification:expired" },
            { expiresAt: new Date(0) },
          );
        },
        apply,
      ),
    ).rejects.toThrow("expired");

    expect(apply).not.toHaveBeenCalled();
    expect(await app.db.find(JobLeaseEntity)).toEqual([]);
  });

  it("leaves a cleanup intent for an upload whose reference was never stored", async () => {
    await expect(
      lock.withUploadedObject(
        "crashed-upload",
        async () => {
          await store.put("crashed-upload", Buffer.from("x"), "text/plain");
        },
        async () => {
          throw new Error("crash before the reference was stored");
        },
      ),
    ).rejects.toThrow("crash");

    expect(await queuedKeys()).toEqual(["crashed-upload"]);
    expect(await app.db.find(JobLeaseEntity)).toEqual([]);
    await queue.processCleanupQueue();
    expect(store.objects.has("crashed-upload")).toBe(false);
    expect(await queuedKeys()).toEqual([]);
  });

  it("does not clean up an upload while it is being written", async () => {
    let release!: () => void;
    const writing = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written!: () => void;
    const started = new Promise<void>((resolve) => {
      written = resolve;
    });
    const upload = lock.withUploadedObject(
      "in-flight",
      async () => {
        await store.put("in-flight", Buffer.from("x"), "text/plain");
        written();
        await writing;
      },
      async () => "stored",
    );
    await started;
    await queue.processCleanupQueue();
    expect(store.objects.has("in-flight")).toBe(true);
    expect(await queuedKeys()).toEqual(["in-flight"]);

    release();
    expect(await upload).toBe("stored");
    expect(await queuedKeys()).toEqual([]);
  });

  it("expires abandoned pending and finalized uploads without deleting published assets", async () => {
    const { workspace, user } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    for (const surface of ["draft", "draft-pending", "description"]) {
      await insertRow(app.db, AssetEntity, {
        workspaceId: workspace.id,
        projectId: project.id,
        surface,
        objectKey: `synthetic-expiry-${surface}`,
        filename: "test.png",
        mimeType: "image/png",
        size: 1,
        createdBy: user.id,
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
    }
    await insertRow(app.db, AssetEntity, {
      workspaceId: workspace.id,
      projectId: project.id,
      surface: "draft",
      objectKey: "fresh-draft",
      filename: "test.png",
      mimeType: "image/png",
      size: 1,
      createdBy: user.id,
    });

    await app.get(DraftUploadCleanup).cleanupExpiredDraftUploads();

    expect(
      (await app.db.find(AssetEntity)).map((asset) => asset.surface).sort(),
    ).toEqual(["description", "draft"]);
    expect(await queuedKeys()).toEqual([
      "synthetic-expiry-draft",
      "synthetic-expiry-draft-pending",
    ]);
  });

  it("deletes assets an edit no longer references anywhere in the task", async () => {
    const { workspace, user } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, { projectId: project.id });
    const scope = { workspaceId: workspace.id, projectId: project.id };
    const dropped = await insertRow(app.db, AssetEntity, {
      ...scope,
      taskId: task.id,
      objectKey: "dropped",
      filename: "a.png",
      mimeType: "image/png",
      size: 1,
      createdBy: user.id,
    });
    const quoted = await insertRow(app.db, AssetEntity, {
      ...scope,
      taskId: task.id,
      objectKey: "quoted",
      filename: "b.png",
      mimeType: "image/png",
      size: 1,
      createdBy: user.id,
    });
    await store.put("dropped", Buffer.from("a"), "image/png");
    await store.put("quoted", Buffer.from("b"), "image/png");
    await insertRow(app.db, CommentEntity, {
      taskId: task.id,
      userId: user.id,
      content: `see /api/asset/${quoted.id}`,
    });

    await app
      .get(OrphanedAssetCleanup)
      .deleteOrphanedAssets(
        `/api/asset/${dropped.id} /api/asset/${quoted.id}`,
        "nothing left",
        { taskId: task.id },
      );

    expect((await app.db.find(AssetEntity)).map((asset) => asset.id)).toEqual([
      quoted.id,
    ]);
    expect([...store.objects.keys()]).toEqual(["quoted"]);
  });
});
