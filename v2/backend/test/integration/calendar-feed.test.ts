import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CALENDAR_DESCRIPTION_CHARACTERS,
  CALENDAR_TASK_BATCH_SIZE,
} from "../../src/calendar-feed/calendar-feed-reader.service";
import { CalendarFeedEntity } from "../../src/database/entities/calendar-feed.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { WorkspaceRoleEntity } from "../../src/database/entities/workspace-role.entity";
import { LabelUpdateService } from "../../src/label/label-update.service";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRows } from "../support/fixtures/project-insert-rows";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type Feed = {
  id: string;
  projectId: string;
  token: string;
  labelIds: string[];
  timeZone: string;
  createdAt: string;
};

const feedPath = (feed: Feed) =>
  `/api/calendar-feed/${feed.token}/calendar.ics`;

describe("API integration: calendar feeds", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    app.auth.signOut();
  });

  async function setup(role = "owner") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const labels: LabelEntity[] = [];
    for (const name of ["Release", "Maintenance"])
      labels.push(
        await createLabel(app.db, {
          name,
          color: "gray",
          workspaceId: member.workspace.id,
        }),
      );
    app.auth.signIn(member.user);
    const endpoint = `/api/calendar-feed/project/${project.id}`;
    const create = (
      body: unknown = {
        labelIds: labels.map((label) => label.id),
        timeZone: "Europe/Berlin",
      },
    ) =>
      app.request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    return { member, project, labels, endpoint, create };
  }

  const labelCopy = (workspaceId: string, name: string, taskId: string) =>
    createLabel(app.db, { name, color: "gray", workspaceId, taskId });

  const updateLabel = (id: string, name: string, color: string) =>
    app.get(LabelUpdateService).updateLabel(id, name, color);

  it.each([{}, { labelIds: [] }])(
    "includes all scheduled project tasks without label creation permission when labels are omitted or empty: %j",
    async (body) => {
      const { member, project, labels, create, endpoint } =
        await setup("calendar-publisher");
      await addWorkspaceRole(
        app.db,
        member.workspace.id,
        "calendar-publisher",
        {
          project: ["share"],
        },
      );
      const { project: otherProject } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const foreign = await createWorkspaceMember(app.db);
      const { project: foreignProject } = await createProjectFixture(app.db, {
        workspaceId: foreign.workspace.id,
      });
      const labeled = await createTask(app.db, {
        title: "Scheduled labeled",
        projectId: project.id,
        number: 1,
        dueDate: new Date(),
      });
      await createTask(app.db, {
        title: "Scheduled unlabeled",
        projectId: project.id,
        number: 2,
        startDate: new Date(),
      });
      await createTask(app.db, {
        title: "Unscheduled",
        projectId: project.id,
        number: 3,
      });
      await createTask(app.db, {
        title: "Other project",
        projectId: otherProject.id,
        dueDate: new Date(),
      });
      await createTask(app.db, {
        title: "Foreign workspace",
        projectId: foreignProject.id,
        dueDate: new Date(),
      });
      await labelCopy(member.workspace.id, labels[0]!.name, labeled.id);

      const response = await create(body);
      expect(response.status).toBe(201);
      const feed = (await response.json()) as Feed;
      expect(feed.labelIds).toEqual([]);
      expect(feed.timeZone).toBe("UTC");
      expect(await (await app.request(endpoint)).json()).toEqual([feed]);
      app.auth.signOut();
      const calendar = await (await app.request(feedPath(feed))).text();
      expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(2);
      expect(calendar).toContain("SUMMARY:Scheduled labeled");
      expect(calendar).toContain("SUMMARY:Scheduled unlabeled");
      expect(calendar).not.toContain("SUMMARY:Unscheduled");
      expect(calendar).not.toContain("SUMMARY:Other project");
      expect(calendar).not.toContain("SUMMARY:Foreign workspace");
    },
  );

  it("creates a feed in a workspace with no labels", async () => {
    const { labels, create } = await setup();
    for (const label of labels)
      await app.db.delete(LabelEntity, { id: label.id });
    const response = await create({ labelIds: [] });
    expect(response.status).toBe(201);
    expect(((await response.json()) as Feed).labelIds).toEqual([]);
    expect(await app.db.count(LabelEntity)).toBe(0);
  });

  it("creates distinct persistent subscriptions and exposes only scheduled matching project tasks without a session", async () => {
    const { member, project, labels, create, endpoint } = await setup();
    const { project: otherProject } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const seeds: Partial<TaskEntity>[] = [
      {
        title: "Both labels",
        projectId: project.id,
        number: 1,
        startDate: new Date("2026-09-22T22:00:00Z"),
        dueDate: new Date("2026-09-24T22:00:00Z"),
      },
      {
        title: "Only maintenance",
        projectId: project.id,
        number: 2,
        dueDate: new Date("2026-09-25T22:00:00Z"),
      },
      {
        title: "Start only",
        projectId: project.id,
        number: 3,
        startDate: new Date("2026-09-27T22:00:00Z"),
      },
      { title: "Unscheduled", projectId: project.id, number: 4 },
      {
        title: "No matching label",
        projectId: project.id,
        number: 5,
        dueDate: new Date(),
      },
      {
        title: "Another project",
        projectId: otherProject.id,
        number: 1,
        dueDate: new Date(),
      },
    ];
    const tasks: TaskEntity[] = [];
    for (const seed of seeds)
      tasks.push(
        await createTask(
          app.db,
          seed as Partial<TaskEntity> & {
            projectId: string;
          },
        ),
      );
    const workspaceId = member.workspace.id;
    for (const task of tasks.filter((t) => t.title !== "No matching label"))
      await labelCopy(
        workspaceId,
        task.title === "Only maintenance" ? labels[1]!.name : labels[0]!.name,
        task.id,
      );
    await labelCopy(workspaceId, labels[1]!.name, tasks[0]!.id);

    const created = await create();
    expect(created.status).toBe(201);
    const feed = (await created.json()) as Feed;
    expect(feed.token).toMatch(/^[a-f0-9]{64}$/);
    const second = (await (await create()).json()) as Feed;
    expect(second.token).not.toBe(feed.token);
    expect(await (await app.request(endpoint)).json()).toHaveLength(2);
    app.auth.signOut();
    const response = await app.request(feedPath(feed));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const ics = await response.text();
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    for (const title of ["Both labels", "Only maintenance", "Start only"])
      expect(ics).toContain(`SUMMARY:${title}`);
    for (const title of ["Unscheduled", "No matching label", "Another project"])
      expect(ics).not.toContain(title);
    expect(ics).toContain(
      "DTSTART;VALUE=DATE:20260923\r\nDTEND;VALUE=DATE:20260926",
    );
    await app.db.update(
      TaskEntity,
      { id: tasks[0]!.id },
      { title: "Rescheduled", dueDate: new Date("2026-10-01T22:00:00Z") },
    );
    const refreshed = await (await app.request(feedPath(feed))).text();
    expect(refreshed).toContain("SUMMARY:Rescheduled");
    expect(refreshed).toContain(`UID:${tasks[0]!.id}@kaneo`);
    expect(refreshed).toContain("DTEND;VALUE=DATE:20261003");
    await app.db.update(
      TaskEntity,
      { id: tasks[0]!.id },
      { projectId: otherProject.id, number: 10 },
    );
    expect(await (await app.request(feedPath(feed))).text()).not.toContain(
      "Rescheduled",
    );
  });

  it.each([true, false])(
    "streams every task across batches once and bounds oversized Unicode text (filtered: %s)",
    async (filtered) => {
      const { member, project, labels, create } = await setup();
      const count = CALENDAR_TASK_BATCH_SIZE * 2 + 3;
      const description =
        "🚀".repeat(CALENDAR_DESCRIPTION_CHARACTERS) +
        "omitted".repeat(150_000);
      const taskIds = await insertRows(
        app.db,
        TaskEntity,
        Array.from({ length: count }, (_, i) => ({
          title: i === 0 ? "T".repeat(1100) : `Task ${i}`,
          description:
            i === 0 ? description : i === 1 ? "Short description" : null,
          projectId: project.id,
          number: i + 1,
          dueDate: new Date("2026-09-23T00:00:00Z"),
        })),
      );
      await insertRows(
        app.db,
        LabelEntity,
        taskIds.flatMap((taskId) =>
          labels.map((label) => ({
            name: label.name,
            color: "gray",
            workspaceId: member.workspace.id,
            taskId,
          })),
        ),
      );
      const feed = (await (
        await create(filtered ? undefined : { labelIds: [] })
      ).json()) as Feed;
      const response = await app.request(feedPath(feed));
      expect(response.status).toBe(200);
      const text = await response.text();
      const unfolded = text.replaceAll("\r\n ", "");
      expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(count);
      for (const taskId of taskIds)
        expect(unfolded.split(`UID:${taskId}@kaneo\r\n`)).toHaveLength(2);
      expect(unfolded).toContain(
        `DESCRIPTION:${"🚀".repeat(CALENDAR_DESCRIPTION_CHARACTERS)}…\r\n`,
      );
      expect(unfolded).toContain("DESCRIPTION:Short description\r\n");
      expect(unfolded).toContain(`SUMMARY:${"T".repeat(1024)}…\r\n`);
      expect(unfolded).not.toContain("omitted");
      expect(Buffer.byteLength(text)).toBeLessThan(100_000);
      expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    },
  );

  it("preserves label renames and never broadens the feed when labels are deleted", async () => {
    const { member, project, labels, create } = await setup();
    const task = await createTask(app.db, {
      title: "Release task",
      projectId: project.id,
      dueDate: new Date(),
    });
    await labelCopy(member.workspace.id, labels[0]!.name, task.id);
    const feed = (await (
      await create({ labelIds: [labels[0]!.id] })
    ).json()) as Feed;
    await updateLabel(labels[0]!.id, "Renamed", "gray");
    expect(await (await app.request(feedPath(feed))).text()).toContain(
      "SUMMARY:Release task",
    );
    await app.db.delete(LabelEntity, { id: labels[0]!.id });
    const result = await (await app.request(feedPath(feed))).text();
    expect(result).toContain("BEGIN:VCALENDAR");
    expect(result).not.toContain("BEGIN:VEVENT");
  });

  it.each([true, false])(
    "keeps feeds stable after a task label is removed (workspace definition: %s)",
    async (hasDefinition) => {
      const { member, project, labels, create } = await setup();
      const original = await createTask(app.db, {
        title: "Original assignment",
        projectId: project.id,
        number: 1,
        dueDate: new Date(),
      });
      const remaining = await createTask(app.db, {
        title: "Remaining assignment",
        projectId: project.id,
        number: 2,
        dueDate: new Date(),
      });
      const copies = [
        await labelCopy(member.workspace.id, labels[0]!.name, original.id),
        await labelCopy(member.workspace.id, labels[0]!.name, remaining.id),
      ];
      if (!hasDefinition)
        await app.db.delete(LabelEntity, { id: labels[0]!.id });
      const response = await create({
        labelIds: [copies[0]!.id, copies[1]!.id],
      });
      expect(response.status).toBe(201);
      const feed = (await response.json()) as Feed;
      const root = await app.db.findOne(LabelEntity, {
        where: { id: feed.labelIds[0] },
      });
      expect(root?.taskId).toBeNull();
      expect(root?.name).toBe(labels[0]!.name);
      expect(feed.labelIds).toHaveLength(1);
      if (hasDefinition) expect(root?.id).toBe(labels[0]!.id);
      await updateLabel(copies[0]!.id, "Unrelated", "gray");
      expect(await (await app.request(feedPath(feed))).text()).toContain(
        "SUMMARY:Remaining assignment",
      );
      await app.db.delete(LabelEntity, { id: copies[0]!.id });
      expect(await (await app.request(feedPath(feed))).text()).toContain(
        "SUMMARY:Remaining assignment",
      );
      await updateLabel(feed.labelIds[0]!, "Renamed workspace label", "gray");
      expect(await (await app.request(feedPath(feed))).text()).toContain(
        "SUMMARY:Remaining assignment",
      );
    },
  );

  it("requires label creation permission only when a workspace definition is missing", async () => {
    const { member, project, labels, create } =
      await setup("calendar-publisher");
    const role = await addWorkspaceRole(
      app.db,
      member.workspace.id,
      "calendar-publisher",
      { project: ["share"] },
    );
    expect((await create({ labelIds: [labels[0]!.id] })).status).toBe(201);
    const task = await createTask(app.db, {
      title: "Legacy assignment",
      projectId: project.id,
    });
    const copy = await labelCopy(member.workspace.id, "Legacy", task.id);
    expect((await create({ labelIds: [copy.id] })).status).toBe(403);
    expect(await app.db.count(LabelEntity, { where: { name: "Legacy" } })).toBe(
      1,
    );
    await app.db.update(
      WorkspaceRoleEntity,
      { id: role.id },
      {
        permission: JSON.stringify({ project: ["share"], label: ["create"] }),
      },
    );
    expect((await create({ labelIds: [copy.id] })).status).toBe(201);
  });

  it("revokes one link without affecting others and cascades project deletion", async () => {
    const { project, endpoint, create } = await setup();
    const first = (await (await create()).json()) as Feed;
    const second = (await (await create()).json()) as Feed;
    expect(
      (await app.request(`${endpoint}/${first.id}`, { method: "DELETE" }))
        .status,
    ).toBe(200);
    expect((await app.request(feedPath(first))).status).toBe(404);
    expect((await app.request(feedPath(second))).status).toBe(200);
    await app.db.delete(ProjectEntity, { id: project.id });
    expect((await app.request(feedPath(second))).status).toBe(404);
    expect(await app.db.count(CalendarFeedEntity)).toBe(0);
  });

  it.each(["member", "viewer"])(
    "denies feed creation, listing, and revocation to %s roles",
    async (role) => {
      const { endpoint, create } = await setup(role);
      expect((await create()).status).toBe(403);
      expect((await app.request(endpoint)).status).toBe(403);
      expect(
        (await app.request(`${endpoint}/anything`, { method: "DELETE" }))
          .status,
      ).toBe(403);
    },
  );

  it("rejects unauthenticated management requests and invalid secret links", async () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      const path = `/api/calendar-feed/project/missing${method === "DELETE" ? "/feed" : ""}`;
      expect((await app.request(path, { method })).status).toBe(401);
    }
    expect(
      (await app.request(`/api/calendar-feed/${"a".repeat(64)}/calendar.ics`))
        .status,
    ).toBe(404);
    expect(
      (await app.request("/api/calendar-feed/invalid/calendar.ics")).status,
    ).toBe(400);
  });

  it("rejects foreign-workspace labels, invalid selections, and invalid time zones", async () => {
    const { create, labels } = await setup();
    const foreign = await createWorkspaceMember(app.db);
    const foreignLabel = await createLabel(app.db, {
      name: "Foreign",
      color: "gray",
      workspaceId: foreign.workspace.id,
    });
    for (const body of [
      { labelIds: [foreignLabel.id] },
      { labelIds: [""] },
      { labelIds: ["missing"] },
      { labelIds: [labels[0]!.id], timeZone: "Not/A_Zone" },
      { labelIds: Array(101).fill(labels[0]!.id) },
    ])
      expect((await create(body)).status).toBe(400);
    const response = await create({
      labelIds: [labels[0]!.id, labels[0]!.id],
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as Feed).labelIds).toEqual([labels[0]!.id]);
  });

  it("does not allow a project or workspace ID to authorize another project's feed", async () => {
    const { endpoint, create } = await setup();
    const feed = (await (await create()).json()) as Feed;
    const outsider = await createWorkspaceMember(app.db, { role: "owner" });
    const { project: outsiderProject } = await createProjectFixture(app.db, {
      workspaceId: outsider.workspace.id,
    });
    app.auth.signIn(outsider.user);
    expect(
      (await app.request(`${endpoint}?workspaceId=${outsider.workspace.id}`))
        .status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/calendar-feed/project/${outsiderProject.id}/${feed.id}`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`${endpoint}/${feed.id}`, { method: "DELETE" }))
        .status,
    ).toBe(404);
    expect((await app.request(feedPath(feed))).status).toBe(200);
  });
});
