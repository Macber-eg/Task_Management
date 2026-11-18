import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { withIntegrationTask } from "../../src/integrations/links/integration-task-scope";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api/plugins/github/integration-task-scope.test.ts, which
// stubbed the query builder; these run against PostgreSQL instead.
describe("integration task ownership", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => resetTestDatabase(app.dataSource));

  async function setup() {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "github",
      config: "{}",
    });
    const task = await createTask(app.db, { projectId: project.id });
    const scope = {
      id: integration.id,
      projectId: project.id,
      project: { workspaceId: workspace.id },
    };
    return { workspace, project, integration, task, scope };
  }

  it("locks and checks the integration project, workspace and task before writing", async () => {
    const f = await setup();
    const apply = vi.fn(async (tx) => {
      const locks = (await tx.query(
        `select relation::regclass::text as name, mode from pg_locks
         where pid = pg_backend_pid() and locktype = 'relation'
           and relation::regclass::text in ('project', 'integration', 'task')`,
      )) as { name: string; mode: string }[];
      expect(locks.map((lock) => lock.name)).toEqual(
        expect.arrayContaining(["project", "integration", "task"]),
      );
      return "updated";
    });
    expect(
      await withIntegrationTask(app.db, f.task.id, f.scope, apply),
    ).toBe("updated");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("ignores a project moved out of the authorized workspace", async () => {
    const f = await setup();
    const apply = vi.fn();
    expect(
      await withIntegrationTask(app.db, f.task.id, {
        ...f.scope,
        project: { workspaceId: "another-workspace" },
      }, apply),
    ).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it("ignores a stale link to a task moved into a different project", async () => {
    const f = await setup();
    const other = await createProjectFixture(app.db, {
      workspaceId: f.workspace.id,
    });
    await app.db.update(
      TaskEntity,
      { id: f.task.id },
      { projectId: other.project.id },
    );
    const apply = vi.fn();
    expect(
      await withIntegrationTask(app.db, f.task.id, f.scope, apply),
    ).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it("requires an active binding when no task is given", async () => {
    const f = await setup();
    await app.db.update(
      IntegrationEntity,
      { id: f.integration.id },
      { isActive: false },
    );
    const apply = vi.fn();
    expect(
      await withIntegrationTask(app.db, null, f.scope, apply),
    ).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it("publishes effects only after committing the scoped writes", async () => {
    const f = await setup();
    const effect = vi.fn(async () => {
      expect(
        (await app.db.findOne(TaskEntity, { where: { id: f.task.id } }))
          ?.title,
      ).toBe("Committed");
    });
    await withIntegrationTask(
      app.db,
      f.task.id,
      f.scope,
      async (tx, afterCommit) => {
        await tx.update(TaskEntity, { id: f.task.id }, { title: "Committed" });
        afterCommit(effect);
        expect(effect).not.toHaveBeenCalled();
      },
    );
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("does not publish an event when related writes fail", async () => {
    const f = await setup();
    const effect = vi.fn();
    await expect(
      withIntegrationTask(
        app.db,
        f.task.id,
        f.scope,
        async (tx, afterCommit) => {
          await tx.update(TaskEntity, { id: f.task.id }, { title: "Lost" });
          afterCommit(effect);
          throw new Error("write failed");
        },
      ),
    ).rejects.toThrow("write failed");
    expect(effect).not.toHaveBeenCalled();
    expect(
      (await app.db.findOne(TaskEntity, { where: { id: f.task.id } }))?.title,
    ).toBe("Seed");
  });
});
