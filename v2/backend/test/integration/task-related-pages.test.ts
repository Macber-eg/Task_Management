import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { getPgPool } from "../../src/database/pg-pool";
import { BoardQueryService } from "../../src/task/queries/board/board-query.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { insertRows } from "../support/fixtures/task-b-insert-rows";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Public boards were read through `GET /api/public-project/{id}`, which
// belongs to the project feature; the public paths below call the board
// query with `publicOnly`, which that route delegates to.

type RelatedTask = {
  id: string;
  labels: { id: string }[];
  externalLinks: { id: string; metadata?: unknown }[];
};
type Board = {
  columns: { id: string; tasks: RelatedTask[] }[];
  plannedTasks: RelatedTask[];
};

let app: TestApp;
let board: BoardQueryService;

beforeAll(async () => {
  app = await createTestApp();
  board = app.get(BoardQueryService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
});

async function fixture() {
  const member = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  await app.db.update(ProjectEntity, { id: project.id }, { isPublic: true });
  await insertRows(
    app.db,
    ColumnEntity,
    Array.from({ length: 237 }, (_, i) => ({
      id: `column-${i}`,
      projectId: project.id,
      slug: `extra-${i}`,
      name: `Extra ${i}`,
      position: i + 4,
    })),
  );
  const task = await insertRow(app.db, TaskEntity, {
    projectId: project.id,
    title: "Late column task",
    number: 1,
    status: "extra-236",
    description: "Body",
  });
  const integration = await insertRow(app.db, IntegrationEntity, {
    projectId: project.id,
    type: "github",
    config: "{}",
  });
  await insertRows(
    app.db,
    LabelEntity,
    Array.from({ length: 237 }, (_, i) => ({
      id: `label-${String(i).padStart(3, "0")}`,
      taskId: task.id,
      workspaceId: member.workspace.id,
      name: `Label ${i}`,
      color: "red",
    })),
  );
  await insertRows(
    app.db,
    ExternalLinkEntity,
    Array.from({ length: 203 }, (_, i) => ({
      id: `link-${String(i).padStart(3, "0")}`,
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: String(i),
      url: `https://example.com/issues/${i}`,
      metadata: JSON.stringify({ state: "open" }),
    })),
  );
  app.auth.signIn(member.user);
  return { member, project, task };
}

async function readPage(
  projectId: string,
  isPublic: boolean,
  relatedPage: number,
) {
  if (isPublic)
    return board.getTasks(projectId, { relatedPage, publicOnly: true });
  const response = await app.request(
    `/api/task/tasks/${projectId}?relatedPage=${relatedPage}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    data: Board;
    pagination: Record<string, unknown>;
  };
}

describe("bounded board related pages", () => {
  it.each([false, true])(
    "returns bounded rows and all related records on the public=%s path",
    async (isPublic) => {
      const { project, task } = await fixture();
      const labels = new Set<string>();
      const links = new Set<string>();
      const columns = new Set<string>();
      for (let relatedPage = 1; relatedPage <= 3; relatedPage++) {
        const json = await readPage(project.id, isPublic, relatedPage);
        const data = json.data as unknown as Board;
        expect(json.pagination).toMatchObject({
          total: 1,
          totalPages: 1,
          relatedPage,
          relatedTotalPages: 3,
          relatedPageSize: 100,
        });
        expect(data.columns.length).toBeLessThanOrEqual(101);
        const tasks = data.columns.flatMap((column) => column.tasks);
        expect(tasks).toHaveLength(1);
        const [only] = tasks;
        expect(only?.id).toBe(task.id);
        expect(only?.labels.length).toBeLessThanOrEqual(100);
        expect(only?.externalLinks.length).toBeLessThanOrEqual(100);
        for (const value of only?.labels ?? []) labels.add(value.id);
        for (const value of only?.externalLinks ?? []) links.add(value.id);
        for (const value of data.columns) columns.add(value.id);
      }
      expect(labels.size).toBe(237);
      expect(links.size).toBe(203);
      expect(columns.size).toBe(241);
    },
  );

  it("does not let malformed legacy link metadata break the board", async () => {
    const { project, task } = await fixture();
    for (const metadata of ["broken {", "null", '"primitive"', "[1,2]"]) {
      await app.db.update(ExternalLinkEntity, { id: "link-000" }, { metadata });
      const response = await board.getTasks(project.id);
      const data = response.data as unknown as Board;
      expect(
        data.columns
          .flatMap((column) => column.tasks)
          .find((entry) => entry.id === task.id)?.externalLinks[0]?.metadata,
      ).toBeNull();
    }
  });

  it("rejects other workspaces and invalid metadata pages", async () => {
    const { project } = await fixture();
    for (const query of [
      "relatedPage=0",
      "relatedPage=-1",
      "relatedPage=1000001",
      "relatedPage=1e4",
    ])
      expect(
        (await app.request(`/api/task/tasks/${project.id}?${query}`)).status,
      ).toBe(400);
    const other = await createWorkspaceMember(app.db);
    app.auth.signIn(other.user);
    expect(
      (await app.request(`/api/task/tasks/${project.id}?relatedPage=2`)).status,
    ).toBe(404);
  });

  it.skip("rejects revoked public visibility (GET /api/public-project/{id} belongs to the project feature, stream 2)", () => {});

  it("keeps association counts scoped to the selected task page", async () => {
    const { project } = await fixture();
    await insertRow(app.db, TaskEntity, {
      projectId: project.id,
      title: "No related records",
      number: 2,
      status: "planned",
    });
    const page = await board.getTasks(project.id, {
      page: 2,
      limit: 1,
      sortBy: "number",
    });
    const data = page.data as unknown as Board;
    expect(data.plannedTasks).toHaveLength(1);
    expect(data.plannedTasks[0]?.labels).toEqual([]);
    expect(data.plannedTasks[0]?.externalLinks).toEqual([]);
    expect(page.pagination.totalPages).toBe(2);
  });

  it("limits expensive list queries with a retryable database timeout", async () => {
    const { project } = await fixture();
    const lock = await getPgPool(app.dataSource).connect();
    try {
      await lock.query("BEGIN");
      await lock.query('LOCK TABLE "task" IN ACCESS EXCLUSIVE MODE');
      await expect(board.getTasks(project.id)).rejects.toMatchObject({
        status: 503,
        message: "Task list request took too long; retry later",
      });
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
  });
});

it.each(
  ["labels", "links", "columns"].flatMap((collection) =>
    ["create", "delete"].map((change) => ({ collection, change })),
  ),
)(
  "detects $collection $change between public related pages",
  async ({ collection, change }) => {
    const { member, project, task } = await fixture();
    const read = (relatedPage?: number) =>
      board.getTasks(project.id, { limit: 100, relatedPage, publicOnly: true });
    const before = (await read()).pagination;
    const stable = await read(2);
    expect(stable.pagination).toMatchObject({
      revision: before.revision,
      relatedRevision: before.relatedRevision,
    });
    if (collection === "labels") {
      if (change === "delete")
        await app.db.delete(LabelEntity, { id: "label-000" });
      else
        await insertRow(app.db, LabelEntity, {
          id: "label---new",
          taskId: task.id,
          workspaceId: member.workspace.id,
          name: "New label",
          color: "blue",
        });
    } else if (collection === "links") {
      if (change === "delete")
        await app.db.delete(ExternalLinkEntity, { id: "link-000" });
      else
        await insertRow(app.db, ExternalLinkEntity, {
          id: "link---new",
          taskId: task.id,
          resourceType: "issue",
          externalId: "new",
          url: "https://example.com/new",
        });
    } else {
      if (change === "delete")
        await app.db.delete(ColumnEntity, { id: "column-0" });
      else
        await insertRow(app.db, ColumnEntity, {
          id: "column---new",
          projectId: project.id,
          slug: "new",
          name: "New column",
          position: 0,
        });
    }
    const after = (await read(2)).pagination;
    if (collection === "columns")
      expect(after.revision).not.toBe(before.revision);
    else {
      expect(after.revision).not.toBe(before.revision);
      expect(after.relatedRevision).not.toBe(before.relatedRevision);
    }
  },
);

it("detects text and integration updates between public related pages", async () => {
  const { project, task } = await fixture();
  const read = (relatedPage?: number) =>
    board.getTasks(project.id, { limit: 100, relatedPage, publicOnly: true });
  const before = (await read()).pagination;
  await app.db.update(
    TaskEntity,
    { id: task.id },
    { title: "Edited title", description: "Edited body" },
  );
  await app.db.update(
    ExternalLinkEntity,
    { id: "link-000" },
    {
      metadata: JSON.stringify({
        lastSync: { title: { source: "kaneo", value: "Edited title" } },
      }),
    },
  );
  const after = (await read(2)).pagination;
  expect(after.revision).not.toBe(before.revision);
  expect(after.relatedRevision).not.toBe(before.relatedRevision);
});
