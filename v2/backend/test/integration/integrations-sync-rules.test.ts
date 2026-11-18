import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import type { TaskCreatedEvent } from "../../src/integrations/core/task-events";
import { createExternalLink } from "../../src/integrations/links/external-link-writes";
import { withIntegrationLink } from "../../src/integrations/links/with-integration-link";
import { withTaskSyncCreation } from "../../src/integrations/sync/create-task-issue";
import {
  canSyncTask,
  taskMatchesRule,
} from "../../src/integrations/sync/eligibility";
import { ProviderIssues } from "../../src/integrations/sync/provider-issues";
import {
  acceptsIssue,
  defaultSyncRules,
  isSyncPaused,
  readSyncRules,
} from "../../src/integrations/sync/rules";
import { outgoingPredicate } from "../../src/integrations/sync/task-predicate";
import { getSyncIntegration } from "../../src/integrations/sync-routes/get-sync-integration";
import { previewSyncRules } from "../../src/integrations/sync-routes/preview-sync-rules";
import { SyncRulesService } from "../../src/integrations/sync-routes/sync-rules.service";
import { ProjectMoveService } from "../../src/project/project-move.service";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import {
  createProviderIssueDouble,
  setupSyncFixture,
} from "../support/fixtures/integrations-sync-fixture";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/integration-sync-rules.test.ts (rules,
// preview and save). Resume is in integrations-sync-resume.test.ts.
describe("integration label policies", () => {
  const double = createProviderIssueDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      overrides: [[ProviderIssues, double.issues]],
    });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    double.reset();
  });

  const setup = (role?: string) => setupSyncFixture(app, role);
  const findTask = (id: string) =>
    app.db.findOne(TaskEntity, { where: { id } });
  const findLink = (id: string) =>
    app.db.findOne(ExternalLinkEntity, { where: { id } });
  const save = (...args: Parameters<SyncRulesService["saveRules"]>) =>
    app.get(SyncRulesService).saveRules(...args);
  const move = (...args: Parameters<ProjectMoveService["moveProject"]>) =>
    app.get(ProjectMoveService).moveProject(...args);

  it("keeps legacy sync unrestricted and rejects malformed policies", () => {
    expect(readSyncRules("{}")).toEqual(defaultSyncRules);
    expect(
      readSyncRules('{"syncRules":{"outgoing":{"mode":"labels","labels":[]}}}'),
    ).toBeNull();
    const all = {
      syncRules: {
        ...defaultSyncRules,
        incoming: {
          mode: "labels" as const,
          match: "all" as const,
          labels: ["one", "two"],
        },
      },
    };
    expect(acceptsIssue(all, [{ name: "one" }, "two"])).toBe(true);
    expect(acceptsIssue(all, ["one"])).toBe(false);
  });

  it("previews any/all matching, missing labels, and new exports", async () => {
    const f = await setup();
    await f.assign();
    const second = await insertRow(app.db, LabelEntity, {
      workspaceId: f.workspace.id,
      name: "ready",
      color: "#123456",
    });
    const any = {
      ...f.rules,
      outgoing: {
        mode: "labels" as const,
        match: "any" as const,
        labels: [f.label.id, second.id],
      },
    };
    expect(await f.preview(any)).toMatchObject({
      total: 1,
      matching: 1,
      willCreate: 1,
    });
    expect(
      await f.preview({ ...any, outgoing: { ...any.outgoing, match: "all" } }),
    ).toMatchObject({ matching: 0 });
    expect(
      await f.preview({
        ...any,
        outgoing: { ...any.outgoing, labels: [f.label.id, "missing"] },
      }),
    ).toMatchObject({ matching: 0, missingLabels: ["missing"] });
  });

  it("uses stable workspace label IDs across renames and fails closed during deletion", async () => {
    const f = await setup();
    await f.assign();
    await app.db.query(
      `UPDATE label SET name = 'renamed' WHERE workspace_id = $1 AND name = 'sync'`,
      [f.workspace.id],
    );
    expect(
      await taskMatchesRule(app.db, f.task.id, f.project.id, f.rules.outgoing),
    ).toBe(true);
    await app.db.update(
      LabelEntity,
      { id: f.label.id },
      { deletionStartedAt: new Date() },
    );
    expect(
      await taskMatchesRule(app.db, f.task.id, f.project.id, f.rules.outgoing),
    ).toBe(false);
  });

  it("limits eligibility scopes to selected roots while keeping the complete preview picker", async () => {
    const f = await setup();
    await f.assign();
    for (let index = 0; index < 200; index++)
      await insertRow(app.db, LabelEntity, {
        workspaceId: f.workspace.id,
        name: `Unrelated label ${index}`,
        color: "#123456",
      });
    const scope = await outgoingPredicate(
      app.db,
      f.workspace.id,
      f.rules.outgoing,
    );
    expect(scope.labels.map((label) => label.id)).toEqual([f.label.id]);
    expect((await f.preview()).labels).toHaveLength(201);
    expect(
      await taskMatchesRule(app.db, f.task.id, f.project.id, f.rules.outgoing),
    ).toBe(true);
    const unrestricted = await outgoingPredicate(app.db, f.workspace.id, {
      mode: "all",
    });
    expect(unrestricted.labels).toEqual([]);
    expect((await f.preview(defaultSyncRules)).labels).toHaveLength(201);
    await app.db.update(
      LabelEntity,
      { id: f.label.id },
      { deletionStartedAt: new Date() },
    );
    expect(
      await taskMatchesRule(app.db, f.task.id, f.project.id, f.rules.outgoing),
    ).toBe(false);
  });

  it("rejects changed impact rather than applying a stale preview", async () => {
    const f = await setup();
    const preview = await f.preview();
    await f.assign();
    const response = await f.request("", "PATCH", {
      rules: f.rules,
      previewToken: preview.previewToken,
    });
    expect(response.status).toBe(409);
    expect(
      readSyncRules(
        (await getSyncIntegration(app.db, f.project.id, "gitea")).config,
      ),
    ).toEqual(defaultSyncRules);
  });

  it.each(["unrelated rename", "unrelated color", "selected color"])(
    "saves a reviewed label rule after an %s change",
    async (change) => {
      const f = await setup();
      await f.assign();
      const other = await insertRow(app.db, LabelEntity, {
        workspaceId: f.workspace.id,
        name: "Unrelated",
        color: "#123456",
      });
      const preview = await f.preview();
      await app.db.update(
        LabelEntity,
        { id: change === "selected color" ? f.label.id : other.id },
        change === "unrelated rename"
          ? { name: "Renamed" }
          : { color: "#654321" },
      );
      expect(
        (
          await f.request("", "PATCH", {
            rules: f.rules,
            previewToken: preview.previewToken,
          })
        ).status,
      ).toBe(200);
      expect(
        readSyncRules(
          (await getSyncIntegration(app.db, f.project.id, "gitea")).config,
        ),
      ).toEqual(f.rules);
    },
  );

  it("rejects a selected label rename even when task eligibility is unchanged", async () => {
    const f = await setup();
    await f.assign();
    const preview = await f.preview();
    await app.db.query(
      `UPDATE label SET name = 'Renamed' WHERE workspace_id = $1 AND name = $2`,
      [f.workspace.id, f.label.name],
    );
    expect((await f.preview()).matching).toBe(preview.matching);
    expect(
      (
        await f.request("", "PATCH", {
          rules: f.rules,
          previewToken: preview.previewToken,
        })
      ).status,
    ).toBe(409);
  });

  it("rejects labels belonging to another workspace", async () => {
    const f = await setup();
    const other = await createWorkspaceMember(app.db);
    const label = await insertRow(app.db, LabelEntity, {
      workspaceId: other.workspace.id,
      name: "sync",
      color: "#000000",
    });
    const rules = {
      ...f.rules,
      outgoing: {
        mode: "labels" as const,
        match: "any" as const,
        labels: [label.id],
      },
    };
    const preview = await f.preview(rules);
    expect(preview.labels.some((item) => item.id === label.id)).toBe(false);
    expect(
      (
        await f.request("", "PATCH", {
          rules,
          previewToken: preview.previewToken,
        })
      ).status,
    ).toBe(400);
  });

  it("lets members inspect rules but reserves preview and writes for settings managers", async () => {
    const f = await setup("member");
    expect((await f.request("", "GET")).status).toBe(200);
    expect(
      (await f.request("/preview", "POST", { rules: f.rules })).status,
    ).toBe(403);
    expect(
      (
        await f.request("", "PATCH", {
          rules: f.rules,
          previewToken: "a".repeat(64),
        })
      ).status,
    ).toBe(403);
    const outsider = await createWorkspaceMember(app.db, { role: "owner" });
    app.auth.signIn(outsider.user);
    expect((await f.request("", "GET")).status).toBe(404);
  });

  it("answers the saved rules and scope over HTTP, and previews through HTTP", async () => {
    const f = await setup();
    await f.assign();
    const current = await f.request("", "GET");
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      isActive: true,
      rules: defaultSyncRules,
      total: 1,
      matching: 1,
      previewToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const preview = await f.request("/preview", "POST", { rules: f.rules });
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as { previewToken: string };
    expect(body.previewToken).toBe((await f.preview()).previewToken);
    expect(
      (await f.request("/preview", "POST", { rules: { outgoing: {} } }))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/api/integration-sync/project/${f.project.id}/slack`,
        )
      ).status,
    ).toBe(400);
  });

  it("rejects a rule save if the project moves after workspace authorization", async () => {
    const f = await setup();
    const target = await createWorkspaceMember(app.db, { role: "owner" });
    const rules = { ...defaultSyncRules, incoming: f.rules.incoming };
    const preview = await f.preview(rules);
    const original = app.dataSource.transaction.bind(app.dataSource);
    vi.spyOn(app.dataSource, "transaction").mockImplementationOnce((async (
      ...args: unknown[]
    ) => {
      await move(f.project.id, f.workspace.id, target.workspace.id, target.user.id);
      return (original as (...a: unknown[]) => Promise<unknown>)(...args);
    }) as never);
    const publish = vi.spyOn(app.get(EventBus), "publish");
    const response = await f.request("", "PATCH", {
      rules,
      previewToken: preview.previewToken,
    });
    expect(response.status).toBe(403);
    expect(
      await app.db.findOne(IntegrationEntity, {
        where: { id: f.integration.id },
      }),
    ).toMatchObject({ config: f.integration.config });
    expect(publish).not.toHaveBeenCalledWith(
      "integration.sync_rules_changed",
      expect.anything(),
    );
  });

  it("returns the authorized workspace's saved preview if the project moves after commit", async () => {
    const f = await setup();
    const target = await createWorkspaceMember(app.db, { role: "owner" });
    const privateLabel = await insertRow(app.db, LabelEntity, {
      workspaceId: target.workspace.id,
      name: "Private destination label",
      color: "#abcdef",
    });
    const preview = await f.preview(defaultSyncRules);
    const bus = app.get(EventBus);
    const publish = bus.publish.bind(bus);
    vi.spyOn(bus, "publish").mockImplementation(async (name, data, options) => {
      if (name === "integration.sync_rules_changed")
        await move(
          f.project.id,
          f.workspace.id,
          target.workspace.id,
          target.user.id,
        );
      else await publish(name, data, options);
    });
    const response = await f.request("", "PATCH", {
      rules: defaultSyncRules,
      previewToken: preview.previewToken,
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as { labels: unknown[] };
    expect(saved.labels).toEqual([expect.objectContaining({ id: f.label.id })]);
    expect(JSON.stringify(saved)).not.toContain(privateLabel.id);
    expect(JSON.stringify(saved)).not.toContain(privateLabel.name);
    expect(
      await app.db.findOne(ProjectEntity, { where: { id: f.project.id } }),
    ).toMatchObject({ workspaceId: target.workspace.id });
  });

  it("pauses excluded links, preserves metadata, and never silently resumes", async () => {
    const f = await setup();
    const link = await f.link();
    const preview = await f.preview();
    expect(preview).toMatchObject({ willPause: 1, matching: 0 });
    await save(
      f.project.id,
      "gitea",
      f.rules,
      preview.previewToken,
      f.workspace.id,
    );
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
    let stored = await findLink(link.id);
    expect(JSON.parse(stored!.metadata!)).toMatchObject({
      syncFilterPaused: true,
      retained: "preserve-me",
    });
    await f.assign();
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
    expect(await f.preview()).toMatchObject({ needsReview: 1, willCreate: 0 });
    await withIntegrationLink(app.db, link, f.integration, async (tx) =>
      tx.update(TaskEntity, { id: f.task.id }, { title: "Should not be applied" }),
    );
    expect((await findTask(f.task.id))!.title).toBe("Kaneo title");
    stored = await findLink(link.id);
    expect(isSyncPaused(stored!.metadata)).toBe(true);
  });

  it("pauses a linked task when its last qualifying label is removed", async () => {
    const f = await setup();
    await f.assign();
    await f.setRules();
    const link = await f.link();
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(true);
    await app.db.delete(LabelEntity, { taskId: f.task.id });
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
    expect(isSyncPaused((await findLink(link.id))!.metadata)).toBe(true);
  });

  it("counts tasks once even when older duplicate issue links exist", async () => {
    const f = await setup();
    await f.link();
    await f.link(true);
    expect(await f.preview()).toMatchObject({
      total: 1,
      paused: 1,
      willPause: 0,
    });
  });

  it("serializes simultaneous task-created and label events", async () => {
    const f = await setup();
    await f.assign();
    await f.setRules();
    const binding = await getSyncIntegration(app.db, f.project.id, "gitea");
    const event: TaskCreatedEvent = {
      taskId: f.task.id,
      projectId: f.project.id,
      title: "Stale queued title",
      number: 1,
      status: "to-do",
      userId: f.user.id,
      description: null,
      priority: null,
    };
    const context = {
      integrationId: f.integration.id,
      projectId: f.project.id,
      config: JSON.parse(binding.config) as Record<string, unknown>,
    };
    const create = vi.fn(async (current: typeof event) => {
      expect(current.title).toBe("Kaneo title");
      const existing = await app.db.findOne(ExternalLinkEntity, {
        where: { taskId: f.task.id },
      });
      if (!existing)
        await createExternalLink(app.db, {
          taskId: f.task.id,
          integrationId: f.integration.id,
          resourceType: "issue",
          externalId: "123",
          url: "https://git.example/123",
        });
    });
    await Promise.all([
      withTaskSyncCreation(app.db, event, context, create),
      withTaskSyncCreation(app.db, event, context, create),
    ]);
    expect(create).toHaveBeenCalledOnce();
    expect(
      await app.db.find(ExternalLinkEntity, { where: { taskId: f.task.id } }),
    ).toHaveLength(1);
  });

  it("pages a large paused scope and preserves metadata across batched rule saves", async () => {
    const f = await setup();
    await f.link();
    const values: unknown[] = [f.project.id, f.integration.id];
    const rows: string[] = [];
    for (let index = 0; index < 205; index++) {
      const number = index + 2;
      rows.push(`('t${String(number).padStart(4, "0")}', $1, ${number}, 'Task ${index}')`);
    }
    await app.db.query(
      `INSERT INTO task (id, project_id, number, title) VALUES ${rows.join(", ")}`,
      [f.project.id],
    );
    await app.db.query(
      `INSERT INTO external_link (id, task_id, integration_id, resource_type, external_id, url, metadata)
       SELECT 'l' || task.id, task.id, $2, 'issue', task.number::text,
              'https://git.example/issues/' || task.number,
              json_build_object('retained', task.id, 'deferredIssueEdit', json_build_object('id', 'old-job'))::text
       FROM task WHERE task.project_id = $1 AND task.number > 1`,
      values,
    );
    const preview = await f.preview();
    expect(preview).toMatchObject({ total: 206, willPause: 206, paused: 206 });
    expect(preview.pausedTasks).toHaveLength(25);
    expect(preview.pausedNextCursor).toBeTruthy();
    await save(
      f.project.id,
      "gitea",
      f.rules,
      preview.previewToken,
      f.workspace.id,
    );
    const links = await app.db.find(ExternalLinkEntity);
    expect(links.every((link) => isSyncPaused(link.metadata))).toBe(true);
    expect(
      links.filter(
        (link) =>
          (JSON.parse(link.metadata!) as { deferredIssueEdit?: { id: string } })
            .deferredIssueEdit?.id === "old-job",
      ),
    ).toHaveLength(205);
    const binding = await getSyncIntegration(app.db, f.project.id, "gitea");
    const first = await previewSyncRules(app.db, binding, f.rules);
    const second = await previewSyncRules(
      app.db,
      binding,
      f.rules,
      first.pausedNextCursor!,
    );
    expect(second.previewToken).toBe(first.previewToken);
    expect(second.pausedTasks).toHaveLength(25);
    expect(
      second.pausedTasks.every((task) => task.id > first.pausedNextCursor!),
    ).toBe(true);
  });
});
