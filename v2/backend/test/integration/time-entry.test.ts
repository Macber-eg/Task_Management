import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TimeEntryEntity } from "../../src/database/entities/time-entry.entity";
import { TimeEntryAuditEntity } from "../../src/database/entities/time-entry-audit.entity";
import { EventBus } from "../../src/events/event-bus";
import { NotificationDeliveryService } from "../../src/notification-preferences/delivery/notification-delivery.service";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("API integration: time entries", () => {
  const events: unknown[] = [];
  let app: TestApp;

  function json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    app.get(EventBus).subscribe("time-entry.created", async (data) => {
      events.push(data);
    });
    // Notifications raised by the event are covered by their own suites.
    vi.spyOn(
      app.get(NotificationDeliveryService),
      "deliverNotification",
    ).mockResolvedValue();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    events.length = 0;
  });

  async function ownerWithTask() {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Tracked task",
      description: "",
      priority: "low",
      status: "to-do",
      columnId: columns.todo.id,
      number: 1,
      position: 1,
    });
    app.auth.signIn(user);
    return { user, workspace, project, task };
  }

  const create = (body: Record<string, unknown>) =>
    app.request("/api/time-entry", json("POST", body));

  // Ported from the previous time entry duration suite.
  describe("time entry duration", () => {
    it("records elapsed seconds when the entry is created already closed", async () => {
      const { task } = await ownerWithTask();
      const response = await create({
        taskId: task.id,
        startTime: "2026-01-01T09:00:00.000Z",
        endTime: "2026-01-01T10:30:00.000Z",
      });
      expect(response.status).toBe(200);
      const entry = (await response.json()) as Record<string, unknown>;
      expect(entry.duration).toBe(5400);
    });

    it("leaves duration unset while the entry is still running", async () => {
      const { task } = await ownerWithTask();
      const response = await create({
        taskId: task.id,
        startTime: "2026-01-01T09:00:00.000Z",
      });
      expect(response.status).toBe(200);
      const entry = (await response.json()) as Record<string, unknown>;
      expect(entry.duration).toBeNull();
    });

    it.skip("rejects a search with no workspace (a search route test that lived in this file; needs the search routes, which are not ported yet)", () => {});
  });

  describe("time entry duration backfill", () => {
    it.skip("recomputes closed entries, clears running ones and tolerates legacy rows (runs the previous backend's 0043 Drizzle data migration, which the v2 baseline schema does not carry)", () => {});
  });

  describe("time entry validation", () => {
    it("rejects an end time before the start time", async () => {
      const { task } = await ownerWithTask();
      const response = await create({
        taskId: task.id,
        startTime: "2026-01-01T10:00:00.000Z",
        endTime: "2026-01-01T09:00:00.000Z",
      });
      expect(response.status).toBe(400);
      expect((await readErrorBody(response)).message).toBe(
        "Start time cannot be after end time. Please adjust the time range.",
      );
    });

    it.each([
      ["an unparseable start time", { startTime: "not-a-date" }],
      ["a calendar-invalid date", { startTime: "2026-02-30T10:00:00Z" }],
      ["a non-ISO date format", { startTime: "01/02/2026" }],
      [
        "an unparseable end time",
        { startTime: "2026-01-01T09:00:00.000Z", endTime: "garbage" },
      ],
    ])("rejects %s", async (_name, times) => {
      const { task } = await ownerWithTask();
      const response = await create({ taskId: task.id, ...times });
      expect(response.status).toBe(400);
    });

    it("rejects a span that would overflow the duration column", async () => {
      const { task } = await ownerWithTask();
      const response = await create({
        taskId: task.id,
        startTime: "1900-01-01T00:00:00.000Z",
        endTime: "2026-01-01T00:00:00.000Z",
      });
      expect(response.status).toBe(400);
    });
  });

  // Ported from the previous unit suite for updateTimeEntry, through HTTP.
  describe("updating a time entry", () => {
    async function closedEntry() {
      const context = await ownerWithTask();
      const entry = await insertRow(app.db, TimeEntryEntity, {
        taskId: context.task.id,
        userId: context.user.id,
        description: "",
        startTime: new Date("2026-08-10T10:00:00.000Z"),
        endTime: new Date("2026-08-10T11:00:00.000Z"),
        duration: 3600,
      });
      return { ...context, entry };
    }

    it("preserves a stored endTime and duration when endTime is omitted", async () => {
      const { entry, user } = await closedEntry();
      const response = await app.request(
        `/api/time-entry/${entry.id}`,
        json("PUT", {
          startTime: "2026-08-10T10:15:00.000Z",
          description: "renamed",
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: entry.id,
        startTime: "2026-08-10T10:15:00.000Z",
        endTime: "2026-08-10T11:00:00.000Z",
        duration: 2700,
        description: "renamed",
      });
      const [audit] = await app.db.find(TimeEntryAuditEntity);
      expect(audit).toMatchObject({
        timeEntryId: entry.id,
        taskId: entry.taskId,
        actorUserId: user.id,
        action: "update",
        beforeData: expect.objectContaining({ duration: 3600 }),
        afterData: expect.objectContaining({
          duration: 2700,
          description: "renamed",
        }),
      });
    });

    it("rejects a startTime later than the preserved endTime", async () => {
      const { entry } = await closedEntry();
      const response = await app.request(
        `/api/time-entry/${entry.id}`,
        json("PUT", { startTime: "2026-08-10T12:00:00.000Z" }),
      );
      expect(response.status).toBe(400);
      expect(
        await app.db.findOneByOrFail(TimeEntryEntity, { id: entry.id }),
      ).toMatchObject({ duration: 3600 });
      expect(await app.db.count(TimeEntryAuditEntity)).toBe(0);
    });

    it("rejects a startTime later than an endTime supplied in the same update", async () => {
      const { entry } = await closedEntry();
      const response = await app.request(
        `/api/time-entry/${entry.id}`,
        json("PUT", {
          startTime: "2026-08-10T12:00:00.000Z",
          endTime: "2026-08-10T11:00:00.000Z",
        }),
      );
      expect(response.status).toBe(400);
    });

    it("still allows an open entry to have its startTime moved forward", async () => {
      const { task, user } = await ownerWithTask();
      const entry = await insertRow(app.db, TimeEntryEntity, {
        taskId: task.id,
        userId: user.id,
        startTime: new Date("2026-08-10T10:00:00.000Z"),
        endTime: null,
        duration: null,
      });
      const response = await app.request(
        `/api/time-entry/${entry.id}`,
        json("PUT", { startTime: "2026-08-10T12:00:00.000Z" }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        startTime: "2026-08-10T12:00:00.000Z",
        endTime: null,
        duration: null,
      });
    });

    it("answers 404 for an unknown entry", async () => {
      await ownerWithTask();
      const response = await app.request(
        "/api/time-entry/missing",
        json("PUT", { startTime: "2026-08-10T12:00:00.000Z" }),
      );
      expect(response.status).toBe(404);
    });
  });

  // Not in the previous suite: pins the remaining routes and the event.
  describe("time entry routes", () => {
    it("starts one running timer, reports it as active and announces it", async () => {
      const { user, project, workspace, task } = await ownerWithTask();
      const started = await create({
        taskId: task.id,
        startTime: "2026-01-01T09:00:00.000Z",
        description: "Pairing",
      });
      const entry = (await started.json()) as Record<string, unknown>;
      expect(entry).toMatchObject({
        taskId: task.id,
        userId: user.id,
        description: "Pairing",
        endTime: null,
      });
      expect(events).toEqual([
        {
          timeEntryId: entry.id,
          taskId: task.id,
          userId: user.id,
          type: "create",
          content: "started time tracking",
          taskOwnerId: null,
          taskTitle: "Tracked task",
          initiatorId: user.id,
        },
      ]);

      const second = await create({
        taskId: task.id,
        startTime: "2026-01-01T10:00:00.000Z",
      });
      expect(second.status).toBe(409);
      expect((await readErrorBody(second)).message).toBe(
        "Stop your current timer before starting another",
      );

      const active = await app.request("/api/time-entry/active");
      expect(active.status).toBe(200);
      expect(await active.json()).toEqual({
        running: {
          ...entry,
          taskTitle: "Tracked task",
          taskNumber: 1,
          projectId: project.id,
          workspaceId: workspace.id,
          projectSlug: project.slug,
        },
      });
    });

    it("answers a null active timer when none runs", async () => {
      await ownerWithTask();
      const response = await app.request("/api/time-entry/active");
      expect(await response.json()).toEqual({ running: null });
    });

    it("lists a task's entries with their user's name, oldest first", async () => {
      const { user, task } = await ownerWithTask();
      const later = await insertRow(app.db, TimeEntryEntity, {
        taskId: task.id,
        userId: user.id,
        startTime: new Date("2026-01-02T09:00:00.000Z"),
        endTime: new Date("2026-01-02T10:00:00.000Z"),
        duration: 3600,
      });
      const earlier = await insertRow(app.db, TimeEntryEntity, {
        taskId: task.id,
        userId: null,
        startTime: new Date("2026-01-01T09:00:00.000Z"),
        endTime: new Date("2026-01-01T10:00:00.000Z"),
        duration: 3600,
      });

      const response = await app.request(`/api/time-entry/task/${task.id}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        expect.objectContaining({ id: earlier.id, userName: null }),
        expect.objectContaining({ id: later.id, userName: user.name }),
      ]);

      const one = await app.request(`/api/time-entry/${later.id}`);
      expect(await one.json()).toEqual(
        JSON.parse(JSON.stringify(later)) as unknown,
      );
    });

    it("deletes an entry after auditing it", async () => {
      const { user, task } = await ownerWithTask();
      const entry = await insertRow(app.db, TimeEntryEntity, {
        taskId: task.id,
        userId: user.id,
        startTime: new Date("2026-01-01T09:00:00.000Z"),
        endTime: new Date("2026-01-01T10:00:00.000Z"),
        duration: 3600,
      });

      const response = await app.request(`/api/time-entry/${entry.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: entry.id });
      expect(await app.db.count(TimeEntryEntity)).toBe(0);
      expect(await app.db.find(TimeEntryAuditEntity)).toEqual([
        expect.objectContaining({
          timeEntryId: entry.id,
          action: "delete",
          actorUserId: user.id,
          beforeData: expect.objectContaining({ id: entry.id }),
          afterData: null,
        }),
      ]);

      const missing = await app.request(`/api/time-entry/${entry.id}`, {
        method: "DELETE",
      });
      expect(missing.status).toBe(404);
    });

    it("blocks entries of a project outside a restricted member's selection", async () => {
      const ctx = await createRestrictedWorkspace(app.db);
      app.auth.signIn(ctx.restricted);

      const hidden = await app.request(
        `/api/time-entry/task/${ctx.betaTask.id}`,
      );
      expect(hidden.status).toBe(403);
      const visible = await app.request(
        `/api/time-entry/task/${ctx.alphaTask.id}`,
      );
      expect(visible.status).toBe(200);
      const write = await create({
        taskId: ctx.betaTask.id,
        startTime: "2026-01-01T09:00:00.000Z",
      });
      expect(write.status).toBe(403);
    });

    it("refuses a viewer without task:update", async () => {
      const { workspace, task } = await ownerWithTask();
      const { user: viewer } = await createWorkspaceMember(app.db);
      await addWorkspaceMember(app.db, workspace.id, viewer.id, "viewer");
      app.auth.signIn(viewer);
      const response = await create({
        taskId: task.id,
        startTime: "2026-01-01T09:00:00.000Z",
      });
      expect(response.status).toBe(403);
    });
  });
});
