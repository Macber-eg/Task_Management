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
import { LabelEntity } from "../../src/database/entities/label.entity";
import type { TaskEntity } from "../../src/database/entities/task.entity";
import { getPgPool } from "../../src/database/pg-pool";
import { EventBus } from "../../src/events/event-bus";
import {
  LABEL_DELETE_BATCH_SIZE,
  LabelDeletionService,
} from "../../src/label/label-deletion.service";
import {
  LabelDeletionLock,
  MAX_LABEL_DELETIONS_IN_FLIGHT,
} from "../../src/label/label-deletion-lock";
import { LabelIntegrationSync } from "../../src/label/label-integration-sync";
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

const sync = createLabelIntegrationSyncDouble();
const github = sync.removeLabelFromGitHub;
const gitea = sync.removeLabelFromGitea;
const gitlab = sync.removeLabelFromGitlab;

let app: TestApp;
let deletion: LabelDeletionService;
let lock: LabelDeletionLock;
let eventGate: Promise<void> | undefined;
let eventCalls: string[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  app = await createTestApp({ overrides: [[LabelIntegrationSync, sync]] });
  deletion = app.get(LabelDeletionService);
  lock = app.get(LabelDeletionLock);
  app
    .get(EventBus)
    .subscribe<{ taskId: string }>("task.label_deleted", async (data) => {
      eventCalls.push(data.taskId);
      await eventGate;
    });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  resetLabelIntegrationSyncDouble(sync);
  eventGate = undefined;
  eventCalls = [];
});

async function fixture(count: number) {
  const member = await createWorkspaceMember(app.db, { role: "admin" });
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  const root = await createLabel(app.db, {
    workspaceId: member.workspace.id,
    name: "bug",
    color: "red",
  });
  const tasks: TaskEntity[] = [];
  for (let i = 0; i < count; i++) {
    const task = await createTask(app.db, {
      projectId: project.id,
      title: `Task ${i}`,
      status: "to-do",
      number: i + 1,
    });
    tasks.push(task);
    await createLabel(app.db, {
      workspaceId: member.workspace.id,
      taskId: task.id,
      name: "bug",
      color: "red",
    });
  }
  app.auth.signIn(member.user);
  return { member, project, root, tasks };
}

function labelsFor(workspaceId: string) {
  return app.db.find(LabelEntity, { where: { workspaceId } });
}

function requestDeletion(target: TestApp, id: string) {
  return target.request(`/api/label/${id}`, { method: "DELETE" });
}

describe("bounded, resumable label deletion", () => {
  it("finishes all copies through bounded HTTP steps and keeps the root until completion", async () => {
    const { member, root } = await fixture(LABEL_DELETE_BATCH_SIZE * 2 + 3);
    const first = await requestDeletion(app, root.id);
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({
      id: root.id,
      pendingDeletion: true,
    });
    expect(github).toHaveBeenCalledTimes(LABEL_DELETE_BATCH_SIZE);
    expect(gitea).toHaveBeenCalledTimes(LABEL_DELETE_BATCH_SIZE);
    expect(gitlab).toHaveBeenCalledTimes(LABEL_DELETE_BATCH_SIZE);
    expect(eventCalls).toHaveLength(LABEL_DELETE_BATCH_SIZE);
    const remaining = await labelsFor(member.workspace.id);
    expect(remaining).toHaveLength(LABEL_DELETE_BATCH_SIZE + 4);
    const marker = remaining.find(
      (label) => label.id === root.id,
    )?.deletionStartedAt;
    expect(marker).toBeInstanceOf(Date);
    // A fresh app/request resumes persisted state, without an in-memory cursor.
    const freshApp = await createTestApp({
      auth: app.auth,
      overrides: [[LabelIntegrationSync, sync]],
    });
    try {
      const second = await requestDeletion(freshApp, root.id);
      expect(second.status).toBe(202);
    } finally {
      await freshApp.close();
    }
    expect(
      (await labelsFor(member.workspace.id)).find(
        (label) => label.id === root.id,
      )?.deletionStartedAt,
    ).toEqual(marker);
    expect((await requestDeletion(app, root.id)).status).toBe(200);
    expect(await labelsFor(member.workspace.id)).toEqual([]);
    expect(github).toHaveBeenCalledTimes(LABEL_DELETE_BATCH_SIZE * 2 + 3);
    expect(new Set(eventCalls).size).toBe(eventCalls.length);
  });

  it("does not start the next provider operation until the current one resolves", async () => {
    const { member, root } = await fixture(3);
    const gate = deferred();
    github.mockImplementationOnce(async () => gate.promise);
    const pending = deletion.deleteLabel(root.id, member.user.id);
    try {
      await vi.waitFor(() => expect(github).toHaveBeenCalledTimes(1));
      expect(gitea).not.toHaveBeenCalled();
      expect(gitlab).not.toHaveBeenCalled();
      expect(eventCalls).toHaveLength(0);
      await expect(
        deletion.deleteLabel(root.id, member.user.id),
      ).rejects.toMatchObject({
        status: 429,
      });
    } finally {
      gate.resolve();
    }
    await pending;
    expect(github).toHaveBeenCalledTimes(3);
    expect(gitea).toHaveBeenCalledTimes(3);
    expect(gitlab).toHaveBeenCalledTimes(3);
  });

  it("awaits real asynchronous event subscribers before deleting another copy", async () => {
    const { member, root } = await fixture(3);
    const gate = deferred();
    eventGate = gate.promise;
    const pending = deletion.deleteLabel(root.id, member.user.id);
    try {
      await vi.waitFor(() => expect(eventCalls).toHaveLength(1));
      expect(github).toHaveBeenCalledTimes(1);
      expect(await labelsFor(member.workspace.id)).toHaveLength(3); // root plus two copies
    } finally {
      gate.resolve();
    }
    await pending;
    expect(eventCalls).toHaveLength(3);
  });

  it("preserves task labels created after the persisted deletion boundary", async () => {
    const { member, root, tasks } = await fixture(LABEL_DELETE_BATCH_SIZE + 1);
    expect(
      (await deletion.deleteLabel(root.id, member.user.id)).pendingDeletion,
    ).toBe(true);
    const deletedTask = github.mock.calls[0]?.[0];
    const newLabel = await createLabel(app.db, {
      workspaceId: member.workspace.id,
      taskId: deletedTask,
      name: "bug",
      color: "blue",
      createdAt: new Date(Date.now() + 1000),
    });
    await deletion.deleteLabel(root.id, member.user.id);
    expect(await labelsFor(member.workspace.id)).toEqual([newLabel]);
    expect(github).toHaveBeenCalledTimes(tasks.length);
  });

  it("prevents root renaming and reassignment while a deletion is pending", async () => {
    const { member, root, tasks } = await fixture(LABEL_DELETE_BATCH_SIZE + 1);
    await deletion.deleteLabel(root.id, member.user.id);
    for (const [path, method, body] of [
      [`/api/label/${root.id}`, "PUT", { name: "renamed", color: "blue" }],
      [`/api/label/${root.id}/task`, "PUT", { taskId: tasks[0]?.id }],
      [
        "/api/label",
        "POST",
        {
          workspaceId: member.workspace.id,
          name: "bug",
          color: "red",
          taskId: tasks[0]?.id,
        },
      ],
    ] as const)
      expect(
        (
          await app.request(path, {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(409);
    expect(
      (await labelsFor(member.workspace.id)).find(
        (label) => label.id === root.id,
      )?.name,
    ).toBe("bug");
  });

  it("completes an empty cascade without provider calls or events", async () => {
    const { member, root } = await fixture(0);
    expect(
      (await deletion.deleteLabel(root.id, member.user.id)).pendingDeletion,
    ).toBeUndefined();
    expect(await labelsFor(member.workspace.id)).toHaveLength(0);
    expect(github).not.toHaveBeenCalled();
    expect(gitea).not.toHaveBeenCalled();
    expect(gitlab).not.toHaveBeenCalled();
    expect(eventCalls).toHaveLength(0);
  });

  it("removes individual task labels with all providers and an awaited event", async () => {
    const { member, root, tasks } = await fixture(1);
    const task = tasks[0] as TaskEntity;
    const copy = await app.db.findOneOrFail(LabelEntity, {
      where: { taskId: task.id, workspaceId: member.workspace.id },
    });
    await deletion.deleteLabel(copy.id, member.user.id);
    expect((await labelsFor(member.workspace.id)).map((row) => row.id)).toEqual(
      [root.id],
    );
    expect(github).toHaveBeenCalledWith(task.id, "bug");
    expect(gitea).toHaveBeenCalledWith(task.id, "bug");
    expect(gitlab).toHaveBeenCalledWith(task.id, "bug");
    expect(eventCalls).toEqual([task.id]);
  });

  it("releases process and database capacity after an operation fails", async () => {
    await expect(
      lock.run("failure", async () => {
        throw new Error("test failure");
      }),
    ).rejects.toThrow("test failure");
    await expect(lock.run("failure", async () => "ok")).resolves.toBe("ok");
  });

  it("honors the four-slot cap held by a separate database session", async () => {
    const { member, root } = await fixture(0);
    const other = await getPgPool(app.dataSource).connect();
    try {
      for (let i = 0; i < MAX_LABEL_DELETIONS_IN_FLIGHT; i++)
        await other.query("SELECT pg_advisory_lock(773622, $1::int)", [i]);
      await expect(
        lock.run("blocked", async () => "must not run"),
      ).rejects.toMatchObject({ status: 429 });
      const response = await requestDeletion(app, root.id);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("1");
      expect(await response.json()).toEqual({
        message: "Label deletion is busy; retry this request",
        code: "RATE_LIMITED",
      });
      expect(
        (await labelsFor(member.workspace.id))[0]?.deletionStartedAt,
      ).toBeNull();
    } finally {
      await other.query("SELECT pg_advisory_unlock_all()");
      other.release();
    }
    await expect(lock.run("available", async () => "ok")).resolves.toBe("ok");
  });

  it("checks workspace access again when another client tries to resume", async () => {
    const { member, root } = await fixture(LABEL_DELETE_BATCH_SIZE + 1);
    expect((await requestDeletion(app, root.id)).status).toBe(202);
    const other = await createWorkspaceMember(app.db, { role: "admin" });
    app.auth.signIn(other.user);
    expect((await requestDeletion(app, root.id)).status).toBe(404);
    expect(await labelsFor(member.workspace.id)).toHaveLength(2);
    expect(github).toHaveBeenCalledTimes(LABEL_DELETE_BATCH_SIZE);
    app.auth.signIn(member.user);
    expect((await requestDeletion(app, root.id)).status).toBe(200);
  });

  it("does not lose local progress or the next event when a provider fails", async () => {
    const { member, root } = await fixture(3);
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
    github.mockRejectedValueOnce(new Error("provider unavailable"));
    try {
      await deletion.deleteLabel(root.id, member.user.id);
      expect(await labelsFor(member.workspace.id)).toHaveLength(0);
      expect(github).toHaveBeenCalledTimes(3);
      expect(gitea).toHaveBeenCalledTimes(3);
      expect(gitlab).toHaveBeenCalledTimes(3);
      expect(eventCalls).toHaveLength(3);
      expect(log).toHaveBeenCalledWith(
        "Failed to synchronize a label removal with an external provider",
      );
    } finally {
      log.mockRestore();
    }
  });
});
