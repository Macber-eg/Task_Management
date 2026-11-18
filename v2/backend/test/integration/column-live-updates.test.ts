import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ColumnCreationService } from "../../src/column/column-creation.service";
import { ColumnDeletionService } from "../../src/column/column-deletion.service";
import { ColumnReorderService } from "../../src/column/column-reorder.service";
import { ColumnUpdateService } from "../../src/column/column-update.service";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { EventBus } from "../../src/events/event-bus";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
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
  publish.mockReset();
});

it("announces committed column changes for focused remote boards", async () => {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const deletion = app.get(ColumnDeletionService);
  const column = await app
    .get(ColumnCreationService)
    .createColumn({ projectId: project.id, name: "Review" });
  await app
    .get(ColumnUpdateService)
    .updateColumn(column.id, { name: "Reviewed", color: "#123456" });
  await app
    .get(ColumnReorderService)
    .reorderColumns(project.id, [{ id: column.id, position: 0 }]);
  await deletion.deleteColumn(column.id);
  expect(publish.mock.calls).toEqual(
    Array.from({ length: 4 }, () => [
      "project.updated",
      { projectId: project.id },
    ]),
  );
  expect(
    await app.db.findOne(ColumnEntity, { where: { id: column.id } }),
  ).toBeNull();
  await expect(deletion.deleteColumn(column.id)).rejects.toThrow(
    "Column not found",
  );
  expect(publish).toHaveBeenCalledTimes(4);
});

it.each(["missing", "foreign"])(
  "rolls back all positions when a later %s column is invalid",
  async (kind) => {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const before = await app.db.find(ColumnEntity, {
      where: { projectId: project.id },
      order: { id: "ASC" },
    });
    let invalidId = "zz-invalid-column";
    if (kind === "foreign") {
      const other = await createWorkspaceMember(app.db);
      const fixture = await createProjectFixture(app.db, {
        workspaceId: other.workspace.id,
      });
      invalidId = fixture.columns.todo.id;
    }
    const [first] = before;
    if (!first) throw new Error("Project fixture has no columns");
    await expect(
      app.get(ColumnReorderService).reorderColumns(project.id, [
        { id: first.id, position: 42 },
        { id: invalidId, position: 43 },
      ]),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await app.db.find(ColumnEntity, {
        where: { projectId: project.id },
        order: { id: "ASC" },
      }),
    ).toEqual(before);
    expect(publish).not.toHaveBeenCalled();
  },
);
