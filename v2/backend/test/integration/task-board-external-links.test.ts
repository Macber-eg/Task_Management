import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { BoardQueryService } from "../../src/task/queries/board/board-query.service";
import { boardTaskSchema } from "../../src/task/response";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The board half of the previous manual-external-links test. Creating,
// listing and removing the link go through `/api/external-link` (the
// external-link feature, stream 3), so the manual link is seeded directly.

type BoardTask = { id: string; externalLinks: unknown[] };
type Board = {
  columns: { tasks: BoardTask[] }[];
  plannedTasks: BoardTask[];
  archivedTasks: BoardTask[];
};

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
});

it("shows a manual link on the board in the documented board task shape", async () => {
  const member = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  const task = await insertRow(app.db, TaskEntity, {
    projectId: project.id,
    title: "Task",
    number: 1,
  });
  const link = await insertRow(app.db, ExternalLinkEntity, {
    taskId: task.id,
    integrationId: null,
    resourceType: "url",
    externalId: "https://example.com/design",
    url: "https://example.com/design",
    title: "Design",
  });

  const board = await app.get(BoardQueryService).getTasks(project.id);
  const data = board.data as unknown as Board;
  const tasks = [
    ...data.columns.flatMap((column) => column.tasks),
    ...data.plannedTasks,
    ...data.archivedTasks,
  ];
  const boardTask = tasks.find((entry) => entry.id === task.id);
  expect(boardTask?.externalLinks).toMatchObject([
    { id: link.id, integrationId: null },
  ]);
  expect(boardTaskSchema.safeParse(boardTask).success).toBe(true);
});
