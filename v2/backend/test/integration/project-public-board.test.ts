import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskRelationEntity } from "../../src/database/entities/task-relation.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { BOARD_DESCRIPTION_MAX_BYTES } from "../../src/project/public-board/board-sql";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { insertRows } from "../support/fixtures/project-insert-rows";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type BoardTask = {
  id: string;
  number: number;
  description: string | null;
  descriptionDeferred: boolean;
  subtaskCounts: { completed: number; total: number };
};
type Board = {
  columns: { tasks: BoardTask[] }[];
  archivedTasks: BoardTask[];
  plannedTasks: BoardTask[];
};

function allTasks(board: Board) {
  return [
    ...board.columns.flatMap((column) => column.tasks),
    ...board.archivedTasks,
    ...board.plannedTasks,
  ];
}

describe("API integration: public project board", () => {
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

  const makePublic = (projectId: string, isPublic = true) =>
    app.db.update(ProjectEntity, { id: projectId }, { isPublic });

  async function fixture(count = 237, publicProject = false) {
    const member = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    if (publicProject) await makePublic(project.id);
    const ids = count
      ? await insertRows(
          app.db,
          TaskEntity,
          Array.from({ length: count }, (_, index) => ({
            id: `page-task-${String(index).padStart(4, "0")}`,
            projectId: project.id,
            title: `Task ${index}`,
            description: `Description ${index}`,
            number: index + 1,
            position: 100,
            status:
              index % 3 === 0
                ? "planned"
                : index % 3 === 1
                  ? "archived"
                  : "to-do",
            priority: index % 2 ? "high" : "low",
          })),
        )
      : [];
    return { project, member, taskIds: ids };
  }

  const revision = async (path: string) =>
    (
      (await (await app.request(path)).json()) as {
        pagination: { revision: string };
      }
    ).pagination.revision;

  describe("bounded pages", () => {
    // The previous test also spied on the task list reader to prove a private
    // board never reaches it; the 403 before any read is asserted instead.
    it("paginates public boards and rechecks visibility on every request", async () => {
      const { project } = await fixture(237, true);
      const first = await app.request(`/api/public-project/${project.id}`);
      expect(first.status).toBe(200);
      const payload = (await first.json()) as Board & {
        pagination: { totalPages: number };
      };
      expect(allTasks(payload)).toHaveLength(50);
      expect(payload.pagination.totalPages).toBe(5);
      const last = await app.request(
        `/api/public-project/${project.id}?page=3&limit=100`,
      );
      expect(last.status).toBe(200);
      expect(allTasks((await last.json()) as Board)).toHaveLength(37);
      await makePublic(project.id, false);
      const denied = await app.request(
        `/api/public-project/${project.id}?page=2`,
      );
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toContain("Description");
    });

    it("validates public pagination before loading a board", async () => {
      const { project } = await fixture(1, true);
      const response = await app.request(
        `/api/public-project/${project.id}?limit=101`,
      );
      expect(response.status).toBe(400);
      expect(await readErrorBody(response)).toMatchObject({
        message: "Invalid task pagination or filters",
        code: "VALIDATION_ERROR",
        issues: [{ path: "query.limit", message: expect.any(String) }],
      });
    });

    it("keeps fixed public-project messages in the standard shape", async () => {
      const response = await app.request(
        "/api/public-project/missing?page=0&limit=1",
      );

      expect(response.status).toBe(400);
      const body = await readErrorBody(response);
      expect(body).toMatchObject({
        message: "Invalid task pagination or filters",
        code: "VALIDATION_ERROR",
      });
      expect(body.issues?.[0]?.path).toMatch(/^query\./);
    });

    it("refuses a project that is not public", async () => {
      const { workspace } = await createWorkspaceMember(app.db);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });

      const response = await app.request(`/api/public-project/${project.id}`);

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(project.name);
    });

    it("answers 404 for a missing project", async () => {
      const response = await app.request("/api/public-project/missing");
      expect(response.status).toBe(404);
      expect(await readErrorBody(response)).toMatchObject({
        message: "Project not found",
      });
    });
  });

  it.each(["create", "delete", "move", "reorder"])(
    "changes the public pagination revision after a concurrent %s",
    async (change) => {
      const { project, taskIds } = await fixture(237, true);
      const before = await revision(
        `/api/public-project/${project.id}?limit=100`,
      );
      expect(typeof before).toBe("string");
      expect(
        await revision(`/api/public-project/${project.id}?page=2&limit=100`),
      ).toBe(before);
      if (change === "create")
        await createTask(app.db, {
          id: "new-public-task",
          projectId: project.id,
          title: "new",
          number: 999,
          position: 1,
        });
      else if (change === "delete")
        await app.db.delete(TaskEntity, { id: taskIds[0] });
      else if (change === "move") {
        const { project: other } = await createProjectFixture(app.db, {
          workspaceId: project.workspaceId,
        });
        await app.db.update(
          TaskEntity,
          { id: taskIds[0] },
          { projectId: other.id },
        );
      } else
        await app.db.update(TaskEntity, { id: taskIds[0] }, { position: 200 });
      expect(
        await revision(`/api/public-project/${project.id}?page=2&limit=100`),
      ).not.toBe(before);
    },
  );

  it("detects task edits between public pages regardless of sort order", async () => {
    const { project, taskIds } = await fixture(237, true);
    const path = `/api/public-project/${project.id}?limit=100`;
    const position = await revision(path);
    const title = await revision(path + "&sortBy=title");
    await app.db.update(
      TaskEntity,
      { id: taskIds[0] },
      { title: "ZZZ new title" },
    );
    expect(await revision(path + "&page=2")).not.toBe(position);
    expect(await revision(path + "&page=2&sortBy=title")).not.toBe(title);
  });

  it.each(["label", "link", "assignee", "project", "subtask"])(
    "detects a %s edit to an earlier public page while loading a later page",
    async (change) => {
      const { project, taskIds, member } = await fixture(2, true);
      const taskId = taskIds[0]!;
      await app.db.update(
        TaskEntity,
        { id: taskId },
        { userId: member.user.id },
      );
      const label = await createLabel(app.db, {
        taskId,
        workspaceId: member.workspace.id,
        name: "Before",
        color: "red",
      });
      const link = await insertRow(app.db, ExternalLinkEntity, {
        taskId,
        resourceType: "pull_request",
        externalId: "1",
        url: "https://example.com/pr/1",
        metadata: JSON.stringify({ merged: false }),
      });
      const { project: childProject } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      await makePublic(childProject.id);
      const child = await createTask(app.db, {
        projectId: childProject.id,
        title: "Child",
        status: "to-do",
      });
      await insertRow(app.db, TaskRelationEntity, {
        sourceTaskId: taskId,
        targetTaskId: child.id,
        relationType: "subtask",
      });
      const path = `/api/public-project/${project.id}?limit=1`;
      const before = await revision(path);
      expect(await revision(path + "&page=2")).toBe(before);
      if (change === "label")
        await app.db.update(LabelEntity, { id: label.id }, { name: "After" });
      if (change === "link")
        await app.db.update(
          ExternalLinkEntity,
          { id: link.id },
          { metadata: JSON.stringify({ merged: true }) },
        );
      if (change === "assignee")
        await app.db.update(
          UserEntity,
          { id: member.user.id },
          { name: "Renamed", image: "https://example.com/avatar.png" },
        );
      if (change === "project")
        await app.db.update(
          ProjectEntity,
          { id: project.id },
          { name: "Renamed project" },
        );
      if (change === "subtask")
        await app.db.update(TaskEntity, { id: child.id }, { status: "done" });
      expect(await revision(path + "&page=2")).not.toBe(before);
    },
  );

  it("excludes cross-workspace relations and private-project counts on public boards", async () => {
    const member = await createWorkspaceMember(app.db);
    const stranger = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const privateProject = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const foreignProject = await createProjectFixture(app.db, {
      workspaceId: stranger.workspace.id,
    });
    await makePublic(project.id);
    const addTask = (projectId: string, status = "to-do") =>
      createTask(app.db, { projectId, title: "Task", status, number: null });
    const relate = (sourceTaskId: string, targetTaskId: string) =>
      insertRow(app.db, TaskRelationEntity, {
        sourceTaskId,
        targetTaskId,
        relationType: "subtask",
      });
    const parent = await addTask(project.id);
    const publicChild = await addTask(project.id, "done");
    const privateChild = await addTask(privateProject.project.id, "done");
    const foreignChild = await addTask(foreignProject.project.id, "done");
    await relate(parent.id, publicChild.id);
    await relate(parent.id, privateChild.id);
    // A legacy malformed relation; it must not cross the workspace boundary.
    await relate(parent.id, foreignChild.id);
    // The previous test also compared the authenticated board ({2, 2}); that
    // route belongs to the task area.
    const response = await app.request(`/api/public-project/${project.id}`);
    expect(response.status).toBe(200);
    const board = (await response.json()) as Board;
    expect(
      board.columns
        .flatMap((column) => column.tasks)
        .find((task) => task.id === parent.id)?.subtaskCounts,
    ).toEqual({ completed: 1, total: 1 });
  });

  describe("large descriptions", () => {
    it("omits large task text from the public board while retaining exact boundary-sized text", async () => {
      const { project } = await fixture(0, true);
      const large = await createTask(app.db, {
        projectId: project.id,
        title: "Task",
        description: "😺".repeat(BOARD_DESCRIPTION_MAX_BYTES / 4 + 1),
        status: "to-do",
        priority: "low",
        number: 1,
      });
      const small = await createTask(app.db, {
        projectId: project.id,
        title: "At boundary",
        number: 2,
        status: "to-do",
        description: "a".repeat(BOARD_DESCRIPTION_MAX_BYTES),
      });
      const response = await app.request(`/api/public-project/${project.id}`);
      expect(response.status).toBe(200);
      const tasks = ((await response.json()) as Board).columns.flatMap(
        (column) => column.tasks,
      );
      expect(tasks.find((entry) => entry.id === large.id)).toMatchObject({
        description: null,
        descriptionDeferred: true,
      });
      expect(tasks.find((entry) => entry.id === small.id)).toMatchObject({
        description: "a".repeat(BOARD_DESCRIPTION_MAX_BYTES),
        descriptionDeferred: false,
      });
    });

    it("defers a large project description on the public board", async () => {
      const { project } = await fixture(0, true);
      await app.db.update(
        ProjectEntity,
        { id: project.id },
        { description: "😺project".repeat(12000) },
      );
      const payload = await (
        await app.request(`/api/public-project/${project.id}`)
      ).json();
      expect(payload).toMatchObject({
        description: null,
        descriptionDeferred: true,
      });
    });
  });
});
