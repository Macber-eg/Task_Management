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
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { StorageCleanupEntity } from "../../src/database/entities/storage-cleanup.entity";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { EventBus } from "../../src/events/event-bus";
import { StorageCleanupQueue } from "../../src/storage/cleanup/storage-cleanup-queue.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp();
  publish = vi.spyOn(app.get(EventBus), "publish");
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  publish.mockClear();
  app.auth.signOut();
});

function deleteProject(projectId: string) {
  return app.request(`/api/project/${projectId}`, { method: "DELETE" });
}

async function queuedKeys() {
  return (await app.db.find(StorageCleanupEntity))
    .map((row) => row.objectKey)
    .sort();
}

function attachment(
  project: ProjectEntity,
  objectKey: string,
  createdBy: string,
) {
  return insertRow(app.db, AssetEntity, {
    projectId: project.id,
    workspaceId: project.workspaceId,
    objectKey,
    filename: "test.png",
    mimeType: "image/png",
    size: 1,
    createdBy,
  });
}

describe("API integration: project deletion", () => {
  it("queues attachment and background keys and answers with the project as it was", async () => {
    const { workspace, user } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
      name: "Doomed",
    });
    await app.db.update(
      ProjectEntity,
      { id: project.id },
      { backgroundObjectKey: "synthetic-background" },
    );
    await attachment(project, "attachment-a", user.id);
    await attachment(project, "attachment-b", user.id);

    app.auth.signIn(user);
    const response = await deleteProject(project.id);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: project.id,
      workspaceId: workspace.id,
      name: "Doomed",
    });
    expect(body).not.toHaveProperty("backgroundObjectKey");
    expect(body).not.toHaveProperty("backgroundMimeType");

    expect(
      await app.db.find(ProjectEntity, { where: { id: project.id } }),
    ).toHaveLength(0);
    expect(
      await app.db.find(ColumnEntity, { where: { projectId: project.id } }),
    ).toHaveLength(0);
    expect(await app.db.find(AssetEntity)).toHaveLength(0);
    // Nothing is deleted from storage here: the keys wait for the cleanup job.
    expect(await queuedKeys()).toEqual([
      "attachment-a",
      "attachment-b",
      "synthetic-background",
    ]);
  });

  it("refreshes parent boards in other projects that count its tasks as subtasks", async () => {
    const { workspace, user } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const { project: parentProject } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const child = await createTask(app.db, {
      projectId: project.id,
      number: 1,
    });
    const sameProjectParent = await createTask(app.db, {
      projectId: project.id,
      number: 2,
    });
    const otherParent = await createTask(app.db, {
      projectId: parentProject.id,
      number: 1,
    });
    for (const parent of [sameProjectParent, otherParent])
      await insertRow(app.db, TaskRelationEntity, {
        sourceTaskId: parent.id,
        targetTaskId: child.id,
        relationType: "subtask",
      });

    app.auth.signIn(user);
    const response = await deleteProject(project.id);

    expect(response.status).toBe(200);
    expect(publish).toHaveBeenCalledWith("subtask-parents.refresh", {
      projects: [{ projectId: parentProject.id }],
    });
  });

  it("publishes an empty refresh when no other board depends on the project", async () => {
    const { workspace, user } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });

    app.auth.signIn(user);
    expect((await deleteProject(project.id)).status).toBe(200);
    expect(publish).toHaveBeenCalledWith("subtask-parents.refresh", {
      projects: [],
    });
  });

  it("requires project:delete permission", async () => {
    const { workspace, user } = await createWorkspaceMember(app.db, {
      role: "viewer",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });

    app.auth.signIn(user);
    const response = await deleteProject(project.id);

    expect(response.status).toBe(403);
    expect(
      await app.db.find(ProjectEntity, { where: { id: project.id } }),
    ).toHaveLength(1);
  });

  it("answers 404 for a missing project", async () => {
    const { user } = await createWorkspaceMember(app.db, { role: "owner" });

    app.auth.signIn(user);
    const response = await deleteProject("project-missing");

    expect(response.status).toBe(404);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Project not found",
    });
  });

  it.skip("retries queued keys with S3 once storage recovers (storage cleanup job and S3 are a later phase)", () => {});
  it.skip("captures storage keys when deleting the workspace through a parent cascade (storage area, not a project route)", () => {});
  it.skip("does not let a batch of failing objects starve later cleanup (storage cleanup job is a later phase)", () => {});
  it.skip("retries failed objects even with a continuous backlog of new keys (storage cleanup job is a later phase)", () => {});
  it.skip("does not delete an object referenced by a newly finalized live asset (storage cleanup job is a later phase)", () => {});
  it.skip("recovers queued attachments after single and bulk task deletion (task routes and the storage cleanup job are not ported here)", () => {});
  it.skip("gives new objects a turn despite a full batch of permanent retries (storage cleanup job is a later phase)", () => {});
  it("queues more than the PostgreSQL parameter limit without rolling back", async () => {
    await app.dataSource.transaction((tx) =>
      app.get(StorageCleanupQueue).queue(
        tx,
        Array.from({ length: 66_000 }, (_, i) => `large-project-${i}`),
      ),
    );
    expect(await app.db.count(StorageCleanupEntity)).toBe(66_000);
  });
  it.skip("keeps the pool available and protects objects during slow verification (storage verification leases are a later phase)", () => {});
  it.skip("declines to finalize after a verification lease expires (storage verification leases are a later phase)", () => {});
  it.skip("rejects single and bulk deletion when a task moves after its authorized read (task routes, stream 1)", () => {});
});
