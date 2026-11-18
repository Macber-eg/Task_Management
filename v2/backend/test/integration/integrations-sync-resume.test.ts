import { Logger } from "@nestjs/common";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { EntityManager } from "typeorm";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { JobLeaseEntity } from "../../src/database/entities/job-lease.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { NotificationEntity } from "../../src/database/entities/notification.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { withIntegrationLink } from "../../src/integrations/links/with-integration-link";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import { ProviderIssues } from "../../src/integrations/sync/provider-issues";
import { defaultSyncRules, isSyncPaused } from "../../src/integrations/sync/rules";
import { lockResumeScope } from "../../src/integrations/sync-routes/lock-resume-scope";
import { SyncResumeReviewService } from "../../src/integrations/sync-routes/sync-resume-review.service";
import { SyncResumeService } from "../../src/integrations/sync-routes/sync-resume.service";
import { ProjectMoveService } from "../../src/project/project-move.service";
import { TaskAssetStorage } from "../../src/task/seams/task-asset-storage";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import {
  createProviderIssueDouble,
  setupSyncFixture,
} from "../support/fixtures/integrations-sync-fixture";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from the "reviewed sync resume" part of
// tests/api-integration/integration-sync-rules.test.ts.
describe("reviewed sync resume", () => {
  const double = createProviderIssueDouble();
  const { provider } = double;
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

  const review = (...args: Parameters<SyncResumeReviewService["review"]>) =>
    app.get(SyncResumeReviewService).review(...args);
  const resumeSync = (...args: Parameters<SyncResumeService["resumeSync"]>) =>
    app.get(SyncResumeService).resumeSync(...args);
  const move = (...args: Parameters<ProjectMoveService["moveProject"]>) =>
    app.get(ProjectMoveService).moveProject(...args);
  const findTask = (id: string) =>
    app.db.findOne(TaskEntity, { where: { id } });
  const findLink = (id: string) =>
    app.db.findOne(ExternalLinkEntity, { where: { id } });
  const idleTransactions = async () =>
    (
      (await app.db.query(
        `select count(*)::int as count from pg_stat_activity
         where datname = current_database() and state = 'idle in transaction'`,
      )) as { count: number }[]
    )[0]!.count;

  async function paused(role?: string) {
    const f = await setupSyncFixture(app, role);
    await f.assign();
    await f.setRules();
    const link = await f.link(true);
    return { ...f, link };
  }

  it("returns not found when disconnect commits between the binding lookups", async () => {
    const f = await paused();
    await expect(
      app.dataSource.transaction(async (tx) => {
        const load = tx.findOne.bind(tx);
        vi.spyOn(tx, "findOne").mockImplementationOnce((async (
          ...args: Parameters<EntityManager["findOne"]>
        ) => {
          const integration = await load(...args);
          await app.db.delete(IntegrationEntity, { id: f.integration.id });
          return integration;
        }) as never);
        await lockResumeScope(
          tx,
          f.project.id,
          "gitea",
          f.link.id,
          f.workspace.id,
        );
      }),
    ).rejects.toMatchObject({ status: 404, message: "Linked task not found" });
    expect(await findLink(f.link.id)).toBeNull();
    expect(provider.write).not.toHaveBeenCalled();
  });

  it("returns a retryable conflict when another instance retains the resume lease", async () => {
    const f = await paused();
    await insertRow(app.db, JobLeaseEntity, {
      name: `sync-resume:${f.link.id}`,
      owner: "crashed-test-instance",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    const response = await f.request(`/links/${f.link.id}/resume`, "POST", {
      source: "kaneo",
      token: "a".repeat(64),
    });
    expect(response.status).toBe(409);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Synchronization is busy; retry shortly",
      code: "CONFLICT",
    });
    expect(provider.read).not.toHaveBeenCalled();
    expect(provider.write).not.toHaveBeenCalled();
    expect((await app.db.find(JobLeaseEntity))[0]?.owner).toBe(
      "crashed-test-instance",
    );
    expect(isSyncPaused((await findLink(f.link.id))!.metadata)).toBe(true);
  });

  for (const authentication of ["custom-role", "api-key"] as const) {
    it.each([{}, { project: ["read"] }, { task: ["read"] }] as Array<
      Record<string, string[]>
    >)(
      `${authentication} cannot inspect or mutate sync without both project and task reads: %j`,
      async (readPermissions) => {
        const f = await setupSyncFixture(
          app,
          authentication === "custom-role" ? "restricted" : "owner",
        );
        await f.assign();
        await f.setRules();
        const link = await f.link(true);
        const permissions = {
          ...readPermissions,
          workspace: ["manage_settings"],
          task: ["update", ...(readPermissions.task ?? [])],
        };
        if (authentication === "custom-role") {
          await addWorkspaceRole(
            app.db,
            f.workspace.id,
            "restricted",
            permissions,
          );
        } else {
          app.auth.signInAs(
            await createApiKeyPrincipal(app.db, f.user, permissions),
          );
        }
        const requests: Array<[string, string, unknown?]> = [
          ["", "GET"],
          ["/preview", "POST", { rules: f.rules }],
          ["", "PATCH", { rules: f.rules, previewToken: "a".repeat(64) }],
          [`/links/${link.id}/review`, "GET"],
          [
            `/links/${link.id}/resume`,
            "POST",
            { source: "kaneo", token: "a".repeat(64) },
          ],
        ];
        for (const [suffix, method, body] of requests) {
          const response = await f.request(suffix, method, body);
          expect(response.status, suffix).toBe(403);
          const text = await response.text();
          expect(text).not.toContain("Kaneo title");
          expect(text).not.toContain("Kaneo body");
          expect(text).not.toContain("Repository title");
        }
        expect(provider.read).not.toHaveBeenCalled();
        expect(provider.write).not.toHaveBeenCalled();
      },
    );
  }

  it.each(["kaneo", "provider"] as const)(
    "reviews and resumes %s values through HTTP with validated responses",
    async (source) => {
      const f = await paused();
      const suffix = `/links/${f.link.id}`;
      const response = await f.request(`${suffix}/review`, "GET");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { token: string };
      expect(body).toMatchObject({
        task: { id: f.task.id, title: "Kaneo title", number: 1 },
        local: {
          title: "Kaneo title",
          description: "Kaneo body",
          state: "open",
        },
        remote: {
          title: "Repository title",
          description: "Repository body",
          state: "closed",
        },
        token: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      for (const invalid of [
        { source: "external", token: body.token },
        { source, token: "short" },
      ])
        expect(
          (await f.request(`${suffix}/resume`, "POST", invalid)).status,
        ).toBe(400);
      expect(provider.write).not.toHaveBeenCalled();
      const resumed = await f.request(`${suffix}/resume`, "POST", {
        source,
        token: body.token,
      });
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toEqual({ success: true });
      expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(
        true,
      );
      expect(await findLink(f.link.id)).toMatchObject({
        title: source === "kaneo" ? "Kaneo title" : "Repository title",
      });
    },
  );

  it("denies HTTP review and resume to members and users outside the workspace", async () => {
    const f = await paused("member");
    const suffix = `/links/${f.link.id}`;
    const resume = { source: "kaneo", token: "a".repeat(64) };
    expect((await f.request(`${suffix}/review`, "GET")).status).toBe(403);
    expect((await f.request(`${suffix}/resume`, "POST", resume)).status).toBe(
      403,
    );
    const outsider = await createWorkspaceMember(app.db, { role: "owner" });
    app.auth.signIn(outsider.user);
    expect((await f.request(`${suffix}/review`, "GET")).status).toBe(404);
    expect((await f.request(`${suffix}/resume`, "POST", resume)).status).toBe(
      404,
    );
    expect(provider.read).not.toHaveBeenCalled();
    expect(provider.write).not.toHaveBeenCalled();
  });

  it("requires task update permission in addition to settings permission to resume over HTTP", async () => {
    const f = await setupSyncFixture(app, "settings-only");
    await addWorkspaceRole(app.db, f.workspace.id, "settings-only", {
      workspace: ["manage_settings"],
      project: ["read"],
      task: ["read"],
    });
    await f.assign();
    await f.setRules();
    const link = await f.link(true);
    const response = await f.request(`/links/${link.id}/review`, "GET");
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    expect(
      (
        await f.request(`/links/${link.id}/resume`, "POST", {
          source: "provider",
          token,
        })
      ).status,
    ).toBe(403);
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
    expect(provider.write).not.toHaveBeenCalled();
  });

  it("rejects a stale local comparison before writing to the provider", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    await app.db.update(TaskEntity, { id: f.task.id }, { title: "Changed locally" });
    await expect(
      resumeSync(f.project.id, "gitea", f.link.id, current.token, "kaneo", f.workspace.id),
    ).rejects.toMatchObject({ status: 409 });
    expect(provider.write).not.toHaveBeenCalled();
  });

  it.each(["task", "integration", "labels", "link", "project"] as const)(
    "allows %s edits during a provider write and retains an uncertain paused link",
    async (change) => {
      const f = await paused();
      const target =
        change === "project" ? await createWorkspaceMember(app.db) : undefined;
      const current = await review(
        f.project.id,
        "gitea",
        f.link.id,
        f.workspace.id,
      );
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      provider.write.mockImplementation(async () => {
        await gate;
        return { updatedAt: "2026-01-02T00:00:00Z" };
      });
      const resume = resumeSync(
        f.project.id,
        "gitea",
        f.link.id,
        current.token,
        "kaneo",
        f.workspace.id,
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        await vi.waitFor(() => expect(provider.write).toHaveBeenCalledOnce());
        const attempts: Record<typeof change, (tx: EntityManager) => Promise<unknown>> = {
          task: (tx) =>
            tx.update(TaskEntity, { id: f.task.id }, { title: "Concurrent edit" }),
          integration: (tx) =>
            tx.update(IntegrationEntity, { id: f.integration.id }, { isActive: false }),
          labels: (tx) => tx.delete(LabelEntity, { taskId: f.task.id }),
          link: (tx) =>
            tx.update(ExternalLinkEntity, { id: f.link.id }, { metadata: "{}" }),
          project: (tx) =>
            tx.update(
              ProjectEntity,
              { id: f.project.id },
              { workspaceId: target!.workspace.id },
            ),
        };
        await app.dataSource.transaction(async (tx) => {
          await tx.query(`set local lock_timeout = '1s'`);
          await attempts[change](tx);
        });
        expect(await idleTransactions()).toBe(0);
      } finally {
        release();
      }
      expect(await resume).toMatchObject({
        status: change === "project" ? 403 : 409,
      });
      const stored = await findLink(f.link.id);
      expect(JSON.parse(stored!.metadata!)).toMatchObject({
        syncFilterPaused: true,
        syncResumeUncertain: true,
      });
      if (change === "task")
        expect(await findTask(f.task.id)).toMatchObject({
          title: "Concurrent edit",
        });
    },
  );

  it.each(["review", "kaneo", "provider"] as const)(
    "rejects %s when the project moves after authorization",
    async (source) => {
      const f = await paused();
      const target = await createWorkspaceMember(app.db, { role: "owner" });
      await f.setRules(defaultSyncRules);
      const current = await review(
        f.project.id,
        "gitea",
        f.link.id,
        f.workspace.id,
      );
      const findOne = app.db.findOne.bind(app.db);
      let moved = false;
      vi.spyOn(app.db, "findOne").mockImplementation((async (
        ...args: Parameters<EntityManager["findOne"]>
      ) => {
        if (!moved && args[0] === IntegrationEntity) {
          moved = true;
          await move(
            f.project.id,
            f.workspace.id,
            target.workspace.id,
            target.user.id,
          );
        }
        return findOne(...args);
      }) as never);
      const response = await f.request(
        `/links/${f.link.id}/${source === "review" ? "review" : "resume"}`,
        source === "review" ? "GET" : "POST",
        source === "review" ? undefined : { source, token: current.token },
      );
      expect(response.status).toBe(403);
      expect(provider.write).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain("Repository body");
      expect(await findTask(f.task.id)).toMatchObject({
        title: f.task.title,
        description: f.task.description,
      });
      expect(isSyncPaused((await findLink(f.link.id))!.metadata)).toBe(true);
    },
  );

  it.each(["review", "kaneo", "provider"] as const)(
    "rejects %s if the project moves while the provider read is pending",
    async (source) => {
      const f = await paused();
      const target = await createWorkspaceMember(app.db, { role: "owner" });
      await f.setRules(defaultSyncRules);
      const current = await review(
        f.project.id,
        "gitea",
        f.link.id,
        f.workspace.id,
      );
      provider.read.mockImplementationOnce(async () => {
        expect(await idleTransactions()).toBe(0);
        await move(
          f.project.id,
          f.workspace.id,
          target.workspace.id,
          target.user.id,
        );
        return current.snapshot.remoteIssue;
      });
      const response = await f.request(
        `/links/${f.link.id}/${source === "review" ? "review" : "resume"}`,
        source === "review" ? "GET" : "POST",
        source === "review" ? undefined : { source, token: current.token },
      );
      expect(response.status).toBe(403);
      expect(provider.write).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain("Repository body");
      expect(await findTask(f.task.id)).toMatchObject({
        title: f.task.title,
        description: f.task.description,
      });
      expect(isSyncPaused((await findLink(f.link.id))!.metadata)).toBe(true);
    },
  );

  it("allows task edits during the provider read and rejects the stale comparison before dispatch", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.read.mockImplementationOnce(async () => {
      await gate;
      return { ...current.remote, updatedAt: current.remoteIssueUpdatedAt };
    });
    provider.read.mockClear();
    const resume = resumeSync(
      f.project.id,
      "gitea",
      f.link.id,
      current.token,
      "kaneo",
      f.workspace.id,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await vi.waitFor(() => expect(provider.read).toHaveBeenCalledOnce());
      await app.dataSource.transaction(async (tx) => {
        await tx.query(`set local lock_timeout = '1s'`);
        await tx.update(TaskEntity, { id: f.task.id }, { title: "Edited during read" });
      });
    } finally {
      release();
    }
    expect(await resume).toMatchObject({ status: 409 });
    expect(provider.write).not.toHaveBeenCalled();
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
  });

  it("pauses again when a repository edit's webhook was discarded during resume", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    let remote = current.snapshot.remoteIssue;
    const ignoredWebhook = vi.fn(async () => {
      await app.db.update(TaskEntity, { id: f.task.id }, { title: "Edited after read" });
    });
    const publish = vi.spyOn(app.get(EventBus), "publish");
    provider.read.mockImplementation(async () => remote);
    provider.read.mockImplementationOnce(async () => {
      const snapshot = remote;
      remote = {
        ...remote,
        title: "Edited after read",
        updatedAt: "new-provider-version",
      };
      await withIntegrationLink(app.db, f.link, f.integration, ignoredWebhook);
      return snapshot;
    });
    await expect(
      resumeSync(f.project.id, "gitea", f.link.id, current.token, "provider", f.workspace.id),
    ).rejects.toMatchObject({ status: 409 });
    expect(ignoredWebhook).not.toHaveBeenCalled();
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
    expect(provider.write).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({ taskId: f.task.id }),
    );
    const followUp = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    expect(followUp.local.title).toBe(current.remote.title);
    expect(followUp.remote.title).toBe("Edited after read");
  });

  it.each(
    (["title", "description", "state"] as const).flatMap((field) =>
      (["partial-write", "concurrent-edit"] as const).map((cause) => ({
        field,
        cause,
      })),
    ),
  )(
    "pauses Kaneo resume when $cause leaves $field different from the selected values",
    async ({ field, cause }) => {
      const f = await paused();
      const current = await review(
        f.project.id,
        "gitea",
        f.link.id,
        f.workspace.id,
      );
      let remote = current.snapshot.remoteIssue;
      const webhook = vi.fn();
      provider.read.mockImplementation(async () => {
        expect(await idleTransactions()).toBe(0);
        return remote;
      });
      provider.write.mockImplementationOnce(async (values) => {
        remote = {
          ...remote,
          ...values,
          [field]:
            cause === "partial-write"
              ? remote[field]
              : field === "state"
                ? "closed"
                : "Concurrent repository edit",
          updatedAt: "new-provider-version",
        };
        if (cause === "concurrent-edit")
          await withIntegrationLink(app.db, f.link, f.integration, webhook);
        return { updatedAt: remote.updatedAt };
      });
      await expect(
        resumeSync(
          f.project.id,
          "gitea",
          f.link.id,
          current.token,
          "kaneo",
          f.workspace.id,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(provider.write).toHaveBeenCalledWith(current.local);
      expect(webhook).not.toHaveBeenCalled();
      expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(
        false,
      );
      const followUp = await review(
        f.project.id,
        "gitea",
        f.link.id,
        f.workspace.id,
      );
      expect(followUp.local).toEqual(current.local);
      expect(followUp.remote[field]).not.toBe(current.local[field]);
    },
  );

  it("verifies adopted repository values outside locks without replaying labels", async () => {
    const f = await paused();
    provider.read.mockResolvedValue({
      title: "Repository title",
      description: "Repository body",
      state: "closed",
      updatedAt: "2026-01-01T00:00:00Z",
      labels: ["priority:low", "custom"],
    });
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    provider.read.mockResolvedValueOnce(current.snapshot.remoteIssue);
    provider.read.mockImplementationOnce(async () => {
      expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(true);
      expect(await idleTransactions()).toBe(0);
      return {
        ...current.snapshot.remoteIssue,
        labels: ["custom", "priority:low", "custom"],
        updatedAt: "new-version",
      };
    });
    await expect(
      resumeSync(f.project.id, "gitea", f.link.id, current.token, "provider", f.workspace.id),
    ).resolves.toEqual({ success: true });
    expect(provider.read).toHaveBeenCalledTimes(3);
    expect(
      await app.db.find(LabelEntity, { where: { taskId: f.task.id } }),
    ).toEqual([expect.objectContaining({ name: f.label.name })]);
  });

  it.each(
    ["kaneo", "provider"].flatMap((source) =>
      ["priority", "status", "custom"].map((field) => ({ source, field })),
    ),
  )(
    "pauses $source resume when $field labels change during the handoff",
    async ({ source, field }) => {
      const f = await paused();
      const labels = ["priority:low", "status:planned", "custom:old"];
      const changed = labels.map((label) =>
        label.startsWith(`${field}:`) ? `${field}:new` : label,
      );
      provider.read.mockResolvedValue({
        title: "Repository title",
        description: "Repository body",
        state: "open",
        updatedAt: "2026-01-01T00:00:00Z",
        labels,
      });
      const current = await review(
        f.project.id,
        "gitea",
        f.link.id,
        f.workspace.id,
      );
      provider.read.mockResolvedValueOnce(current.snapshot.remoteIssue);
      provider.read.mockImplementationOnce(async () => {
        expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(
          true,
        );
        return { ...current.snapshot.remoteIssue, labels: changed };
      });
      await expect(
        resumeSync(
          f.project.id,
          "gitea",
          f.link.id,
          current.token,
          source as "kaneo" | "provider",
          f.workspace.id,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(
        false,
      );
      expect(await findTask(f.task.id)).toMatchObject({
        priority: f.task.priority,
        status: f.task.status,
      });
      expect(
        await app.db.find(LabelEntity, { where: { taskId: f.task.id } }),
      ).toEqual([expect.objectContaining({ name: f.label.name })]);
    },
  );

  it("keeps adoption paused if the verification read fails without exposing provider secrets", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    provider.read.mockResolvedValueOnce(current.snapshot.remoteIssue);
    provider.read.mockRejectedValueOnce(
      new Error("private-provider-token-and-response"),
    );
    await expect(
      resumeSync(f.project.id, "gitea", f.link.id, current.token, "provider", f.workspace.id),
    ).rejects.toMatchObject({ status: 502 });
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private-provider-token-and-response",
    );
  });

  it("records an uncertain provider write when the dispatch transaction fails", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    const transaction = app.dataSource.transaction.bind(app.dataSource) as (
      apply: (tx: EntityManager) => Promise<unknown>,
    ) => Promise<unknown>;
    vi.spyOn(app.dataSource, "transaction").mockImplementationOnce(((
      apply: (tx: EntityManager) => Promise<unknown>,
    ) =>
      transaction(async (tx) => {
        await apply(tx);
        throw new Error("Injected dispatch transaction failure");
      })) as never);
    await expect(
      resumeSync(f.project.id, "gitea", f.link.id, current.token, "kaneo", f.workspace.id),
    ).rejects.toThrow("Injected dispatch transaction failure");
    expect(provider.write).toHaveBeenCalledOnce();
    expect(JSON.parse((await findLink(f.link.id))!.metadata!)).toMatchObject({
      syncFilterPaused: true,
      syncResumeUncertain: true,
    });
  });

  it.each(["planned", "archived"])(
    "keeps an open %s task in its virtual status when adopting repository text",
    async (status) => {
      const f = await paused();
      await app.db.update(TaskEntity, { id: f.task.id }, { status, columnId: null });
      provider.read.mockResolvedValue({
        title: "Repository title",
        description: "Repository body",
        state: "open",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      const publish = vi.spyOn(app.get(EventBus), "publish");
      const current = await review(
        f.project.id,
        "gitea",
        f.link.id,
        f.workspace.id,
      );
      expect(current.local.state).toBe("open");
      await resumeSync(
        f.project.id,
        "gitea",
        f.link.id,
        current.token,
        "provider",
        f.workspace.id,
      );
      expect(await findTask(f.task.id)).toMatchObject({
        status,
        columnId: null,
        title: "Repository title",
        description: "Repository body",
      });
      expect(
        publish.mock.calls.some(([name]) => name === "task.status_changed"),
      ).toBe(false);
    },
  );

  it("adopts repository values and completion state using the existing link", async () => {
    const publish = vi.spyOn(app.get(EventBus), "publish");
    const f = await paused();
    await app.db.update(TaskEntity, { id: f.task.id }, { userId: f.user.id });
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    expect(current.local.title).toBe("Kaneo title");
    await resumeSync(f.project.id, "gitea", f.link.id, current.token, "provider", f.workspace.id);
    expect(await findTask(f.task.id)).toMatchObject({
      title: "Repository title",
      description: "Repository body",
      columnId: f.columns.done.id,
    });
    expect(provider.write).not.toHaveBeenCalled();
    expect(
      await app.db.findOne(ActivityEntity, {
        where: { taskId: f.task.id, type: "title_changed" },
      }),
    ).toMatchObject({
      eventData: { oldTitle: "Kaneo title", newTitle: "Repository title" },
    });
    expect(publish).toHaveBeenCalledWith(
      "task.title_changed",
      expect.objectContaining({
        sourceIntegrationId: f.integration.id,
        oldTitle: "Kaneo title",
        newTitle: "Repository title",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      "task.description_changed",
      expect.objectContaining({
        sourceIntegrationId: f.integration.id,
        newDescription: "Repository body",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({
        sourceIntegrationId: f.integration.id,
        assigneeId: f.user.id,
        taskId: f.task.id,
        oldStatus: f.columns.todo.slug,
        newStatus: f.columns.done.slug,
        title: "Repository title",
      }),
    );
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(true);
    expect(
      await app.db.find(ExternalLinkEntity, { where: { taskId: f.task.id } }),
    ).toHaveLength(1);
    expect((await findLink(f.link.id))?.title).toBe("Repository title");
  });

  it("keeps Kaneo values only after the repository update succeeds", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    await resumeSync(f.project.id, "gitea", f.link.id, current.token, "kaneo", f.workspace.id);
    expect(provider.write).toHaveBeenCalledWith({
      title: "Kaneo title",
      description: "Kaneo body",
      state: "open",
    });
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(true);
    expect((await findLink(f.link.id))?.title).toBe("Kaneo title");
  });

  // The previous test continued with a GitLab reopen webhook; that handler
  // belongs to the GitLab provider port.
  it("records a GitLab link's chosen state in GitLab's own form", async () => {
    const f = await paused();
    await app.db.update(
      IntegrationEntity,
      { id: f.integration.id },
      {
        type: "gitlab",
        config: JSON.stringify({
          baseUrl: "https://git.example",
          accessToken: "test-only",
          projectPath: "team/repo",
          syncRules: f.rules,
        }),
      },
    );
    await app.db.update(
      TaskEntity,
      { id: f.task.id },
      { status: f.columns.inProgress.slug, columnId: f.columns.inProgress.id },
    );
    const current = await review(f.project.id, "gitlab", f.link.id, f.workspace.id);
    await resumeSync(f.project.id, "gitlab", f.link.id, current.token, "kaneo", f.workspace.id);
    const link = await findLink(f.link.id);
    expect(JSON.parse(link!.metadata!)).toMatchObject({
      state: "opened",
      lastSync: { title: { source: "kaneo", value: "Kaneo title" } },
    });
    expect(await findTask(f.task.id)).toMatchObject({
      status: f.columns.inProgress.slug,
      columnId: f.columns.inProgress.id,
    });
  });

  it("runs mention notifications and asset cleanup when adopting repository text", async () => {
    const cleanup = vi
      .spyOn(app.get(TaskAssetStorage), "deleteOrphanedAssets")
      .mockResolvedValue(undefined);
    const f = await paused();
    provider.read.mockResolvedValue({
      title: "Repository title",
      description: `<kaneo-mention id="${f.user.id}">Team member</kaneo-mention>`,
      state: "closed",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    await resumeSync(f.project.id, "gitea", f.link.id, current.token, "provider", f.workspace.id);
    expect(cleanup).toHaveBeenCalledWith(
      "Kaneo body",
      current.remote.description,
      { taskId: f.task.id },
    );
    expect(
      await app.db.findOne(NotificationEntity, {
        where: { resourceId: f.task.id, type: "task_mention" },
      }),
    ).toMatchObject({ userId: f.user.id });
  });

  it("requires a fresh comparison after either side changes", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    provider.read.mockResolvedValue({
      ...current.remote,
      title: "Changed remotely",
      updatedAt: "2026-01-03T00:00:00Z",
    });
    await expect(
      resumeSync(f.project.id, "gitea", f.link.id, current.token, "kaneo", f.workspace.id),
    ).rejects.toMatchObject({ status: 409 });
    expect(provider.write).not.toHaveBeenCalled();
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
  });

  it("records an uncertain resume and refreshes clients if local commit fails after the provider write", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    const transaction = app.dataSource.transaction.bind(app.dataSource) as (
      apply: (tx: EntityManager) => Promise<unknown>,
    ) => Promise<unknown>;
    let calls = 0;
    // The previous test failed the link metadata write; failing the local
    // commit transaction (the second one) exercises the same recovery.
    vi.spyOn(app.dataSource, "transaction").mockImplementation(((
      apply: (tx: EntityManager) => Promise<unknown>,
    ) =>
      ++calls === 2
        ? Promise.reject(new Error("Local metadata commit failed"))
        : transaction(apply)) as never);
    const publish = vi.spyOn(app.get(EventBus), "publish");
    await expect(
      resumeSync(f.project.id, "gitea", f.link.id, current.token, "kaneo", f.workspace.id),
    ).rejects.toThrow("Local metadata commit failed");
    expect(provider.write).toHaveBeenCalledOnce();
    expect(JSON.parse((await findLink(f.link.id))!.metadata!)).toMatchObject({
      syncFilterPaused: true,
      syncResumeUncertain: true,
    });
    expect(publish).toHaveBeenCalledWith("project.updated", {
      projectId: f.project.id,
    });
    expect(publish).toHaveBeenCalledWith("task.updated", {
      projectId: f.project.id,
      taskId: f.task.id,
    });
  });

  it("keeps the link paused when a provider request fails", async () => {
    const f = await paused();
    const current = await review(f.project.id, "gitea", f.link.id, f.workspace.id);
    provider.write.mockRejectedValue(new Error("offline"));
    await expect(
      resumeSync(f.project.id, "gitea", f.link.id, current.token, "kaneo", f.workspace.id),
    ).rejects.toMatchObject({ status: 502 });
    expect(await canSyncTask(app.db, f.task.id, f.integration.id)).toBe(false);
  });

  it.each(["read", "write"] as const)(
    "logs the failed resume %s stage without provider secrets",
    async (stage) => {
      const f = await paused();
      const current = await review(
        f.project.id,
        "gitea",
        f.link.id,
        f.workspace.id,
      );
      const failure = Object.assign(new Error("private-provider-response"), {
        request: { headers: { authorization: "fake-test-secret" } },
      });
      provider[stage].mockRejectedValue(failure);
      const log = vi
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      const response = await f.request(
        `/links/${f.link.id}/${stage === "read" ? "review" : "resume"}`,
        stage === "read" ? "GET" : "POST",
        stage === "read" ? undefined : { source: "kaneo", token: current.token },
      );
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("private-provider-response");
      expect(log).toHaveBeenCalledWith(
        `Sync resume provider ${stage} failed (project ${f.project.id}, gitea, link ${f.link.id})`,
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("fake-test-secret");
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "private-provider-response",
      );
    },
  );

  it("does not review an excluded task or a link from another integration", async () => {
    const f = await paused();
    await app.db.delete(LabelEntity, { taskId: f.task.id });
    await expect(
      review(f.project.id, "gitea", f.link.id, f.workspace.id),
    ).rejects.toMatchObject({ status: 409 });
    const other = await setupSyncFixture(app);
    await expect(
      review(other.project.id, "gitea", f.link.id, other.workspace.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(provider.read).not.toHaveBeenCalled();
  });

  it("answers 502 when no provider plugin can open the issue", async () => {
    vi.spyOn(double.issues, "open").mockRejectedValueOnce(
      new Error("No issue access for provider gitea"),
    );
    const f = await paused();
    const response = await f.request(`/links/${f.link.id}/review`, "GET");
    expect(response.status).toBe(502);
    expect(await readErrorBody(response)).toMatchObject({
      message: "External issue could not be read; sync remains paused",
    });
  });
});
