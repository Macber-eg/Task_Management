import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { getPgPool } from "../../src/database/pg-pool";
import { BoardQueryService } from "../../src/task/queries/board/board-query.service";
import { DescriptionPageService } from "../../src/task/queries/description-page.service";
import {
  BOARD_DESCRIPTION_MAX_BYTES,
  DESCRIPTION_CHUNK_CHARACTERS,
} from "../../src/task/queries/description-sql";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { insertRows } from "../support/fixtures/task-b-insert-rows";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Public boards were read through `GET /api/public-project/{id}` (the
// project feature, stream 2). The board half of those checks calls the board
// query with `publicOnly`, which that route delegates to. The public
// description routes are part of the task feature and stay HTTP requests.

type DescribedTask = { id: string };
type Board = { columns: { tasks: DescribedTask[] }[] };

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

async function fixture(description: string | null, isPublic = false) {
  const member = await createWorkspaceMember(app.db, { role: "owner" });
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  if (isPublic)
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic });
  const task = await insertRow(app.db, TaskEntity, {
    projectId: project.id,
    title: "Task",
    description,
    status: "to-do",
    priority: "low",
    number: 1,
  });
  app.auth.signIn(member.user);
  return { member, project, task };
}

/** The private board over HTTP and the public board from the board query. */
async function bothBoards(projectId: string) {
  const response = await app.request(`/api/task/tasks/${projectId}`);
  expect(response.status).toBe(200);
  const privateBoard = ((await response.json()) as { data: unknown }).data;
  const publicBoard = (await board.getTasks(projectId, { publicOnly: true }))
    .data;
  return [privateBoard, publicBoard] as unknown[];
}

function findTask(data: unknown, id: string) {
  return (data as Board).columns
    .flatMap((column) => column.tasks)
    .find((entry) => entry.id === id);
}

async function readAllPages(url: string) {
  let offset = 0;
  let version: string | undefined;
  let text = "";
  let pages = 0;
  while (true) {
    const response = await app.request(
      `${url}?offset=${offset}${version ? `&version=${version}` : ""}`,
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      content: string;
      version: string;
      nextOffset: number | null;
    };
    expect(Array.from(page.content).length).toBeLessThanOrEqual(
      DESCRIPTION_CHUNK_CHARACTERS,
    );
    if (version) expect(page.version).toBe(version);
    version = page.version;
    text += page.content;
    pages++;
    if (page.nextOffset === null) break;
    expect(page.nextOffset).toBeGreaterThan(offset);
    offset = page.nextOffset;
  }
  return { text, pages, version };
}

describe("large task descriptions", () => {
  it("omits large text from both boards while retaining exact boundary-sized text", async () => {
    const body = "😺".repeat(BOARD_DESCRIPTION_MAX_BYTES / 4 + 1);
    const { project, task } = await fixture(body, true);
    const small = await insertRow(app.db, TaskEntity, {
      projectId: project.id,
      title: "At boundary",
      number: 2,
      status: "to-do",
      description: "a".repeat(BOARD_DESCRIPTION_MAX_BYTES),
    });
    for (const data of await bothBoards(project.id)) {
      expect(findTask(data, task.id)).toMatchObject({
        description: null,
        descriptionDeferred: true,
      });
      expect(findTask(data, small.id)).toMatchObject({
        description: "a".repeat(BOARD_DESCRIPTION_MAX_BYTES),
        descriptionDeferred: false,
      });
    }
  });

  it("moves a summarized task without replacing its stored description and accepts an explicit clear", async () => {
    const body = "kept ".repeat(20000);
    const { project, task } = await fixture(body);
    const update = {
      title: task.title,
      status: "in-progress",
      priority: "low",
      position: 5,
      projectId: project.id,
    };
    const response = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "in-progress",
      description: null,
      descriptionDeferred: true,
    });
    expect(
      (await app.db.findOneBy(TaskEntity, { id: task.id }))?.description,
    ).toBe(body);
    const cleared = await app.request(`/api/task/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...update, description: "" }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      description: "",
      descriptionDeferred: false,
    });
    expect(
      (await app.db.findOneBy(TaskEntity, { id: task.id }))?.description,
    ).toBe("");
  });

  it("reads full Unicode text in bounded pages without splitting or dropping characters", async () => {
    const body = "😺é\n".repeat(DESCRIPTION_CHUNK_CHARACTERS);
    const { project, task } = await fixture(body, true);
    for (const url of [
      `/api/task/${task.id}/description`,
      `/api/public-project/${project.id}/task/${task.id}/description`,
    ]) {
      const { text, pages } = await readAllPages(url);
      expect(text).toBe(body);
      expect(pages).toBe(3);
    }
  });

  it("rejects a stale version rather than joining two revisions", async () => {
    const { task } = await fixture("a".repeat(100000));
    const first = (await (
      await app.request(`/api/task/${task.id}/description`)
    ).json()) as { nextOffset: number; version: string };
    await app.db.update(
      TaskEntity,
      { id: task.id },
      { description: "b".repeat(100000) },
    );
    expect(
      (
        await app.request(
          `/api/task/${task.id}/description?offset=${first.nextOffset}&version=${first.version}`,
        )
      ).status,
    ).toBe(409);
  });

  it("enforces workspace access, public project ownership and visibility on every chunk", async () => {
    const { project, task } = await fixture("secret ".repeat(20000), true);
    const other = await createWorkspaceMember(app.db);
    const { project: otherProject } = await createProjectFixture(app.db, {
      workspaceId: other.workspace.id,
    });
    await app.db.update(
      ProjectEntity,
      { id: otherProject.id },
      { isPublic: true },
    );
    app.auth.signIn(other.user);
    expect((await app.request(`/api/task/${task.id}/description`)).status).toBe(
      404,
    );
    expect(
      (
        await app.request(
          `/api/task/description-matches/${project.id}?query=secret`,
        )
      ).status,
    ).toBe(404);
    app.auth.signOut();
    expect((await app.request(`/api/task/${task.id}/description`)).status).toBe(
      401,
    );
    expect(
      (
        await app.request(
          `/api/public-project/${otherProject.id}/task/${task.id}/description`,
        )
      ).status,
    ).toBe(404);
    const url = `/api/public-project/${project.id}/task/${task.id}/description`;
    const first = (await (await app.request(url)).json()) as {
      nextOffset: number;
      version: string;
    };
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic: false });
    const denied = await app.request(
      `${url}?offset=${first.nextOffset}&version=${first.version}`,
    );
    expect(denied.status).toBe(409);
    expect(await denied.text()).not.toContain("secret");
  });

  it("finds literal description matches on every bounded page, only within the project", async () => {
    const { project, member } = await fixture("needle short");
    const { project: other } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const body = `${"x".repeat(70000)} Needle%_tail`;
    await insertRows(
      app.db,
      TaskEntity,
      Array.from({ length: 203 }, (_, i) => ({
        id: `match-${String(i).padStart(3, "0")}`,
        projectId: project.id,
        number: i + 2,
        title: "Unrelated",
        status: "to-do",
        description: body,
      })),
    );
    await insertRow(app.db, TaskEntity, {
      projectId: other.id,
      title: "Other",
      status: "to-do",
      description: body,
    });
    let after: string | null = null;
    const ids: string[] = [];
    do {
      const response = await app.request(
        `/api/task/description-matches/${project.id}?query=${encodeURIComponent("NEEDLE%_tail")}${after ? `&after=${after}` : ""}`,
      );
      expect(response.status).toBe(200);
      const page = (await response.json()) as {
        ids: string[];
        nextCursor: string | null;
      };
      expect(page.ids.length).toBeLessThanOrEqual(100);
      ids.push(...page.ids);
      after = page.nextCursor;
    } while (after);
    expect(ids).toEqual(
      Array.from(
        { length: 203 },
        (_, i) => `match-${String(i).padStart(3, "0")}`,
      ),
    );
    const absent = (await (
      await app.request(
        `/api/task/description-matches/${project.id}?query=NEEDLE___tail`,
      )
    ).json()) as { ids: string[] };
    expect(absent.ids).toEqual([]);
  });

  it("defers large project descriptions and serves complete public text with version and visibility checks", async () => {
    const { project } = await fixture("task body", true);
    const body = "😺project".repeat(12000);
    await app.db.update(
      ProjectEntity,
      { id: project.id },
      { description: body },
    );
    for (const data of await bothBoards(project.id)) {
      expect(data).toMatchObject({
        description: null,
        descriptionDeferred: true,
      });
    }
    app.auth.signOut();
    const url = `/api/public-project/${project.id}/description`;
    const { text, version } = await readAllPages(url);
    expect(text).toBe(body);
    await app.db.update(
      ProjectEntity,
      { id: project.id },
      { description: "new" },
    );
    expect(
      (await app.request(`${url}?version=${version}&offset=32768`)).status,
    ).toBe(409);
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic: false });
    expect((await app.request(url)).status).toBe(404);
  });

  it("bounds description database work and returns a retryable error after a statement timeout", async () => {
    const { task } = await fixture("body");
    const lock = await getPgPool(app.dataSource).connect();
    try {
      await lock.query("BEGIN");
      await lock.query('LOCK TABLE "task" IN ACCESS EXCLUSIVE MODE');
      await expect(
        app.get(DescriptionPageService).getDescriptionPage(task.id, {
          offset: 0,
        }),
      ).rejects.toMatchObject({
        status: 503,
        message: "Description request took too long; retry later",
      });
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
  });

  it("validates offsets, versions and search length, including the public route", async () => {
    const { project, task } = await fixture(null, true);
    for (const url of [
      `/api/task/${task.id}/description`,
      `/api/public-project/${project.id}/task/${task.id}/description`,
    ]) {
      expect(await (await app.request(url)).json()).toMatchObject({
        content: "",
        nextOffset: null,
      });
      for (const query of [
        "offset=-1",
        "offset=1e9",
        "offset=2147483648",
        "version=bad",
        "offset=1.2",
      ])
        expect((await app.request(`${url}?${query}`)).status).toBe(400);
    }
    for (const query of ["", "a".repeat(257)])
      expect(
        (
          await app.request(
            `/api/task/description-matches/${project.id}?query=${query}`,
          )
        ).status,
      ).toBe(400);
  });
});
