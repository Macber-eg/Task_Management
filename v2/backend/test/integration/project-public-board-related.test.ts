import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { createLabel } from "../support/fixtures/create-label";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { insertRows } from "../support/fixtures/project-insert-rows";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type Pagination = {
  revision: string;
  relatedRevision: string;
  totalPages: number;
};
type BoardTask = {
  id: string;
  labels: { id: string }[];
  externalLinks: { id: string; metadata: unknown }[];
};
type Board = {
  columns: { id: string; tasks: BoardTask[] }[];
  plannedTasks: BoardTask[];
  pagination: Pagination;
};

describe("API integration: public board related pages", () => {
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
    const task = await createTask(app.db, {
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
    return { member, project, task };
  }

  const board = async (path: string) =>
    (await (await app.request(path)).json()) as Board;

  // The previous test ran the same loop on the authenticated board route,
  // which belongs to the task area.
  it("returns bounded rows and all related records on the public path", async () => {
    const { project, task } = await fixture();
    const labels = new Set<string>();
    const links = new Set<string>();
    const columns = new Set<string>();
    for (let relatedPage = 1; relatedPage <= 3; relatedPage++) {
      const response = await app.request(
        `/api/public-project/${project.id}?relatedPage=${relatedPage}`,
      );
      expect(response.status).toBe(200);
      const json = (await response.json()) as Board;
      expect(json.pagination).toMatchObject({
        total: 1,
        totalPages: 1,
        relatedPage,
        relatedTotalPages: 3,
        relatedPageSize: 100,
      });
      expect(json.columns.length).toBeLessThanOrEqual(101);
      const tasks = json.columns.flatMap((column) => column.tasks);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.id).toBe(task.id);
      expect(tasks[0]!.labels.length).toBeLessThanOrEqual(100);
      expect(tasks[0]!.externalLinks.length).toBeLessThanOrEqual(100);
      for (const value of tasks[0]!.labels) labels.add(value.id);
      for (const value of tasks[0]!.externalLinks) links.add(value.id);
      for (const value of json.columns) columns.add(value.id);
    }
    expect(labels.size).toBe(237);
    expect(links.size).toBe(203);
    expect(columns.size).toBe(241);
  });

  // Ported from the authenticated reader test: the public board parses
  // metadata the same way.
  it("does not let malformed legacy link metadata break the board", async () => {
    const { project, task } = await fixture();
    for (const metadata of ["broken {", "null", '"primitive"', "[1,2]"]) {
      await app.db.update(ExternalLinkEntity, { id: "link-000" }, { metadata });
      const json = await board(`/api/public-project/${project.id}`);
      expect(
        json.columns
          .flatMap((column) => column.tasks)
          .find((entry) => entry.id === task.id)?.externalLinks[0]?.metadata,
      ).toBeNull();
    }
  });

  it("rejects revoked public visibility and invalid metadata pages", async () => {
    const { project } = await fixture();
    for (const query of [
      "relatedPage=0",
      "relatedPage=-1",
      "relatedPage=1000001",
      "relatedPage=1e4",
    ])
      expect(
        (await app.request(`/api/public-project/${project.id}?${query}`))
          .status,
      ).toBe(400);
    await app.db.update(ProjectEntity, { id: project.id }, { isPublic: false });
    expect(
      (await app.request(`/api/public-project/${project.id}?relatedPage=2`))
        .status,
    ).toBe(403);
  });

  it("keeps association counts scoped to the selected task page", async () => {
    const { project } = await fixture();
    await createTask(app.db, {
      projectId: project.id,
      title: "No related records",
      number: 2,
      status: "planned",
    });
    const page = await board(
      `/api/public-project/${project.id}?page=2&limit=1&sortBy=number`,
    );
    expect(page.plannedTasks).toHaveLength(1);
    expect(page.plannedTasks[0]!.labels).toEqual([]);
    expect(page.plannedTasks[0]!.externalLinks).toEqual([]);
    expect(page.pagination.totalPages).toBe(2);
  });

  it("limits expensive board reads with a retryable database timeout", async () => {
    const { project } = await fixture();
    const lock = app.dataSource.createQueryRunner();
    await lock.connect();
    try {
      await lock.startTransaction();
      await lock.query('LOCK TABLE "task" IN ACCESS EXCLUSIVE MODE');
      const response = await app.request(`/api/public-project/${project.id}`);
      expect(response.status).toBe(503);
      expect(await readErrorBody(response)).toMatchObject({
        message: "Task list request took too long; retry later",
      });
    } finally {
      await lock.rollbackTransaction();
      await lock.release();
    }
  });

  it.each(
    ["labels", "links", "columns"].flatMap((collection) =>
      ["create", "delete"].map((change) => ({ collection, change })),
    ),
  )(
    "detects $collection $change between public related pages",
    async ({ collection, change }) => {
      const { member, project, task } = await fixture();
      const path = `/api/public-project/${project.id}?limit=100`;
      const before = (await board(path)).pagination;
      expect((await board(path + "&relatedPage=2")).pagination).toMatchObject({
        revision: before.revision,
        relatedRevision: before.relatedRevision,
      });
      if (collection === "labels") {
        if (change === "delete")
          await app.db.delete(LabelEntity, { id: "label-000" });
        else
          await createLabel(app.db, {
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
      } else if (change === "delete")
        await app.db.delete(ColumnEntity, { id: "column-0" });
      else
        await insertRow(app.db, ColumnEntity, {
          id: "column---new",
          projectId: project.id,
          slug: "new",
          name: "New column",
          position: 0,
        });
      const after = (await board(path + "&relatedPage=2")).pagination;
      expect(after.revision).not.toBe(before.revision);
      if (collection !== "columns")
        expect(after.relatedRevision).not.toBe(before.relatedRevision);
    },
  );

  it("detects text and integration updates between public related pages", async () => {
    const { project, task } = await fixture();
    const path = `/api/public-project/${project.id}?limit=100`;
    const before = (await board(path)).pagination;
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
    const after = (await board(path + "&relatedPage=2")).pagination;
    expect(after.revision).not.toBe(before.revision);
    expect(after.relatedRevision).not.toBe(before.relatedRevision);
  });
});
