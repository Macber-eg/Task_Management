import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GiteaPlugin } from "../../src/integrations/gitea/gitea.plugin";
import { GiteaImportService } from "../../src/integrations/gitea/import/gitea-import.service";
import { handleGiteaIssueCommentCreated } from "../../src/integrations/gitea/webhooks/issue-comment-created";
import { handleGiteaIssueEdited } from "../../src/integrations/gitea/webhooks/issue-edited";
import { handleGiteaIssueOpened } from "../../src/integrations/gitea/webhooks/issue-opened";
import { handleGiteaIssueState } from "../../src/integrations/gitea/webhooks/issue-state";
import { outboundStamp } from "../../src/integrations/links/sync-echo";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import {
  type GiteaFakeServer,
  giteaRepoApi,
  startGiteaFakeServer,
} from "../support/fixtures/gitea-fake-server";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api/plugins/gitea/comment-sync.test.ts,
// webhooks/issue-opened.test.ts and rapid-text-sync.test.ts. The previous
// suites mocked the database; these run the handlers against PostgreSQL and a
// fake Gitea.
describe("Gitea webhook handlers", () => {
  let app: TestApp;
  let gitea: GiteaFakeServer;
  let events: EventBus;

  beforeAll(async () => {
    app = await createTestApp();
    gitea = await startGiteaFakeServer();
    events = app.get(EventBus);
  });
  afterAll(async () => {
    await gitea.close();
    await app.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    gitea.reset();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const repository = () => ({
    owner: { login: "owner" },
    name: "repo",
    html_url: `${gitea.baseUrl}/owner/repo`,
  });

  async function setup() {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
      slug: "test",
    });
    const config = {
      baseUrl: gitea.baseUrl,
      accessToken: "test-token",
      repositoryOwner: "owner",
      repositoryName: "repo",
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "gitea",
      isActive: true,
      config: JSON.stringify(config),
    });
    return { workspace, project, columns, integration, config };
  }

  async function linkedTask(
    f: Awaited<ReturnType<typeof setup>>,
    {
      number = 42,
      metadata,
      status = f.columns.todo.slug,
    }: { number?: number; metadata?: unknown; status?: string } = {},
  ) {
    const column = Object.values(f.columns).find((c) => c.slug === status);
    await app.db.query(
      `UPDATE project SET last_task_number = 1 WHERE id = $1`,
      [f.project.id],
    );
    const task = await createTask(app.db, {
      projectId: f.project.id,
      title: "Task title",
      description: "Task description",
      status,
      columnId: column?.id ?? null,
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: f.integration.id,
      resourceType: "issue",
      externalId: String(number),
      url: `${gitea.baseUrl}/owner/repo/issues/${number}`,
      metadata: metadata === undefined ? null : JSON.stringify(metadata),
    });
    return { task, link };
  }

  const taskOf = (id: string) =>
    app.db.findOneByOrFail(TaskEntity, { id });
  const activities = () => app.db.find(ActivityEntity);

  describe("Gitea comment sync", () => {
    function comment(body: string, id = 1) {
      return {
        id,
        body,
        html_url: `${gitea.baseUrl}/owner/repo/issues/42#issuecomment-${id}`,
        user: { login: "regular-user", avatar_url: "" },
        created_at: "2026-09-27T00:00:00Z",
      };
    }

    const deliverWebhook = (integrationId: string, body: string) =>
      handleGiteaIssueCommentCreated(
        app.db,
        {
          action: "created",
          issue: { number: 42 },
          comment: comment(body),
          repository: repository(),
        },
        integrationId,
      );

    async function outboundBody(
      f: Awaited<ReturnType<typeof setup>>,
      taskId: string,
      text = "A comment from Kaneo",
    ) {
      gitea.on(
        "POST",
        giteaRepoApi("owner", "repo", "/issues/42/comments"),
        { id: 99, body: "", html_url: "", created_at: "" },
      );
      await app.get(GiteaPlugin).onTaskCommentCreated(
        {
          taskId,
          projectId: f.project.id,
          userId: "user-1",
          comment: text,
        },
        {
          integrationId: f.integration.id,
          projectId: f.project.id,
          config: f.config,
        },
      );
      const [sent] = gitea.calls(
        "POST",
        giteaRepoApi("owner", "repo", "/issues/42/comments"),
      );
      const body = (sent!.body as { body: string }).body;
      expect(body).toContain(text);
      return body;
    }

    function serveIssueForImport(comments: unknown[]) {
      gitea.on("GET", giteaRepoApi("owner", "repo", "/issues"), [
        {
          id: 1,
          number: 42,
          title: "Issue",
          body: "",
          state: "open",
          labels: [],
          html_url: `${gitea.baseUrl}/owner/repo/issues/42`,
        },
      ]);
      gitea.on("GET", giteaRepoApi("owner", "repo", "/pulls"), []);
      gitea.on(
        "GET",
        giteaRepoApi("owner", "repo", "/issues/42/comments"),
        comments,
      );
    }

    it("does not reimport outbound comments through repeated personal-token webhooks", async () => {
      const f = await setup();
      const { task } = await linkedTask(f);
      const body = await outboundBody(f, task.id);
      await deliverWebhook(f.integration.id, body);
      await deliverWebhook(f.integration.id, `${body}\n`);
      expect(await activities()).toEqual([]);
    });

    it("puts the hidden marker before unclosed Markdown code fences", async () => {
      const f = await setup();
      const { task } = await linkedTask(f);
      const body = await outboundBody(f, task.id, "```ts\nconst example = 1;");
      expect(body).toBe("<!-- kaneo:comment -->\n\n```ts\nconst example = 1;");
      await deliverWebhook(f.integration.id, body);
      expect(await activities()).toEqual([]);
    });

    it.each([
      "Discussing the marker: <!-- kaneo:comment -->",
      "> <!-- kaneo:comment -->\n\nQuoted marker",
      "```html\n<!-- kaneo:comment -->\n```",
    ])(
      "imports native comments discussing or quoting the marker: %s",
      async (body) => {
        const f = await setup();
        await linkedTask(f);
        await deliverWebhook(f.integration.id, body);
        expect(await activities()).toEqual([
          expect.objectContaining({ content: body }),
        ]);
        await app.db.query(`DELETE FROM activity`);
        serveIssueForImport([comment(body)]);
        await app.get(GiteaImportService).importIssues(f.project.id);
        expect(await activities()).toEqual([
          expect.objectContaining({ content: body }),
        ]);
      },
    );

    it("still imports native Gitea comments from the same personal-token user", async () => {
      const f = await setup();
      const { task } = await linkedTask(f);
      await deliverWebhook(f.integration.id, "A comment written in Gitea");
      expect(await activities()).toEqual([
        expect.objectContaining({
          taskId: task.id,
          type: "comment",
          content: "A comment written in Gitea",
          externalUserName: "regular-user",
          externalSource: "gitea",
          eventData: { externalCommentId: 1 },
        }),
      ]);
    });

    it("skips outbound comments during bulk import while preserving native comments", async () => {
      const f = await setup();
      const { task } = await linkedTask(f);
      const body = await outboundBody(f, task.id);
      serveIssueForImport([
        comment(`${body}\nAn edit appended in Gitea`),
        comment("Native comment", 2),
      ]);
      const result = await app.get(GiteaImportService).importIssues(f.project.id);
      expect(result.errors).toBeUndefined();
      expect(result.updated).toBe(1);
      expect(await activities()).toEqual([
        expect.objectContaining({ content: "Native comment" }),
      ]);
    });
  });

  describe("handleGiteaIssueOpened", () => {
    function issueOpenedPayload(labels: Array<string | { name?: string }>) {
      return {
        action: "opened",
        issue: {
          number: 42,
          title: "Fix the login bug",
          body: "Steps to reproduce",
          html_url: `${gitea.baseUrl}/owner/repo/issues/42`,
          labels,
          user: { login: "octocat" },
        },
        repository: repository(),
      };
    }

    it("marks automatic task links and skips their comment webhook", async () => {
      const f = await setup();
      gitea.on(
        "POST",
        giteaRepoApi("owner", "repo", "/issues/42/comments"),
        { id: 1, body: "", html_url: "", created_at: "" },
      );
      const payload = issueOpenedPayload([]);
      await handleGiteaIssueOpened(app.db, events, payload, f.integration.id);
      const [sent] = gitea.calls(
        "POST",
        giteaRepoApi("owner", "repo", "/issues/42/comments"),
      );
      const body = (sent!.body as { body: string }).body;
      expect(body).toMatch(/^<!-- kaneo:comment -->\n\n\[TEST-1\]\(/);
      await handleGiteaIssueCommentCreated(
        app.db,
        {
          action: "created",
          issue: { number: 42 },
          comment: {
            id: 1,
            body,
            html_url: `${payload.issue.html_url}#issuecomment-1`,
            user: { login: "regular-user", avatar_url: "" },
            created_at: "2026-09-27T00:00:00Z",
          },
          repository: repository(),
        },
        f.integration.id,
      );
      expect(await activities()).toEqual([]);
    });

    it("persists a valid default priority when the issue has no priority: label", async () => {
      const f = await setup();
      await app.db.update(
        IntegrationEntity,
        { id: f.integration.id },
        {
          config: JSON.stringify({
            ...f.config,
            commentTaskLinkOnGiteaIssue: false,
          }),
        },
      );
      await handleGiteaIssueOpened(
        app.db,
        events,
        issueOpenedPayload(["type:bug"]),
        f.integration.id,
      );
      const tasks = await app.db.find(TaskEntity);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.priority).toBe("low");
    });

    it("persists the extracted priority label when present", async () => {
      const f = await setup();
      await app.db.update(
        IntegrationEntity,
        { id: f.integration.id },
        {
          config: JSON.stringify({
            ...f.config,
            commentTaskLinkOnGiteaIssue: false,
          }),
        },
      );
      await handleGiteaIssueOpened(
        app.db,
        events,
        issueOpenedPayload(["type:bug", "priority:high"]),
        f.integration.id,
      );
      const tasks = await app.db.find(TaskEntity);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.priority).toBe("high");
    });
  });

  describe("rapid gitea text edits", () => {
    const payload = () => ({
      action: "edited",
      repository: repository(),
      issue: {
        number: 1,
        title: "Remote correction",
        body: "Remote description" as string | null,
        html_url: `${gitea.baseUrl}/owner/repo/issues/1`,
        updated_at: undefined as string | undefined,
      },
      changes: { title: { from: "Old" }, body: { from: "Old body" } } as {
        title?: { from: string };
        body?: { from: string };
      },
    });

    const recentStamps = () => ({
      lastSync: {
        title: {
          source: "kaneo",
          value: "Local title",
          timestamp: new Date().toISOString(),
        },
        description: {
          source: "kaneo",
          value: "Local description",
          timestamp: new Date().toISOString(),
        },
      },
    });

    const issuePath = () => giteaRepoApi("owner", "repo", "/issues/1");
    const serveIssue = (issue: Record<string, unknown>) =>
      gitea.on("GET", issuePath(), { id: 1, number: 1, ...issue });

    const edited = (
      f: Awaited<ReturnType<typeof setup>>,
      body: ReturnType<typeof payload>,
    ) => handleGiteaIssueEdited(app.db, events, body, f.integration.id);

    const stateChange = (
      f: Awaited<ReturnType<typeof setup>>,
      state: "closed" | "open",
      updatedAt?: string,
    ) =>
      handleGiteaIssueState(
        app.db,
        events,
        {
          action: state === "closed" ? "closed" : "reopened",
          repository: repository(),
          issue: {
            number: 1,
            title: "Remote correction",
            html_url: `${gitea.baseUrl}/owner/repo/issues/1`,
            state,
            updated_at: updatedAt,
          },
        },
        state,
        f.integration.id,
      );

    beforeEach(() => {
      serveIssue({ title: "Newest title", body: "Newest body" });
    });

    it("applies a different title and description immediately after an outbound sync", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: recentStamps(),
      });
      await edited(f, payload());
      expect(await taskOf(task.id)).toMatchObject({
        title: "Remote correction",
        description: "Remote description",
      });
    });

    it("still ignores exact title and description echoes", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: recentStamps(),
      });
      const body = payload();
      body.issue.title = "Local title";
      body.issue.body = "Local description";
      await edited(f, body);
      expect(await taskOf(task.id)).toMatchObject({
        title: "Task title",
        description: "Task description",
      });
    });

    it("ignores a delayed first echo after a newer outbound edit", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: {
          lastSync: {
            title: outboundStamp(
              outboundStamp(undefined, "Earlier title", "2026-01-01T00:00:00Z"),
              "Newest title",
              "2026-01-01T00:00:01Z",
            ),
            description: outboundStamp(
              outboundStamp(undefined, "Earlier body", "2026-01-01T00:00:00Z"),
              "Newest body",
              "2026-01-01T00:00:01Z",
            ),
          },
        },
      });
      const body = payload();
      body.issue.title = "Earlier title";
      body.issue.body = "Earlier body";
      body.issue.updated_at = "2026-01-01T00:00:00Z";
      await edited(f, body);
      expect(await taskOf(task.id)).toMatchObject({ title: "Task title" });
    });

    it("allows a new remote edit back to an older outbound value", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: {
          lastSync: {
            title: outboundStamp(
              outboundStamp(undefined, "Earlier title", "2026-01-01T00:00:00Z"),
              "Newest title",
              "2026-01-01T00:00:01Z",
            ),
          },
        },
      });
      const body = payload();
      body.changes = { title: { from: "Newest title" } };
      body.issue.title = "Earlier title";
      body.issue.updated_at = "2026-01-01T00:00:02Z";
      await edited(f, body);
      expect(await taskOf(task.id)).toMatchObject({
        title: "Earlier title",
        description: "Task description",
      });
    });

    it("ignores an older close echo after a newer outbound reopen", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: {
          state: "open",
          lastSync: {
            state: outboundStamp(
              outboundStamp(undefined, "closed", "2026-01-01T00:00:00Z"),
              "open",
              "2026-01-01T00:00:01Z",
            ),
          },
        },
      });
      serveIssue({ state: "open" });
      await stateChange(f, "closed", "2026-01-01T00:00:00Z");
      expect(await taskOf(task.id)).toMatchObject({
        status: f.columns.todo.slug,
      });
    });

    it("ignores an older reopen echo after a newer outbound close", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        status: f.columns.done.slug,
        metadata: {
          state: "closed",
          lastSync: {
            state: outboundStamp(
              outboundStamp(undefined, "open", "2026-01-01T00:00:00Z"),
              "closed",
              "2026-01-01T00:00:01Z",
            ),
          },
        },
      });
      serveIssue({ state: "closed" });
      await stateChange(f, "open", "2026-01-01T00:00:00Z");
      expect(await taskOf(task.id)).toMatchObject({
        status: f.columns.done.slug,
      });
    });

    it("accepts a legitimate remote edit matching a historical outbound value within the same timestamp", async () => {
      const f = await setup();
      const stamp = "2026-01-01T00:00:00Z";
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: {
          lastSync: {
            title: outboundStamp(
              outboundStamp(undefined, "Earlier title", stamp),
              "Newest title",
              stamp,
            ),
            description: outboundStamp(
              outboundStamp(undefined, "Earlier body", stamp),
              "Newest body",
              stamp,
            ),
          },
        },
      });
      serveIssue({ title: "Earlier title", body: "Earlier body" });
      const body = payload();
      body.issue.title = "Earlier title";
      body.issue.body = "Earlier body";
      body.issue.updated_at = stamp;
      await edited(f, body);
      expect(await taskOf(task.id)).toMatchObject({
        title: "Earlier title",
        description: "Earlier body",
      });
      // Each ambiguous field needs a confirmation tied to its locked sync state.
      expect(gitea.calls("GET", issuePath())).toHaveLength(2);
    });

    it("ignores the linked task footer when detecting a description echo", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: recentStamps(),
      });
      const body = payload();
      body.changes = { body: { from: "Old" } };
      body.issue.body = `Local description\n\n---\n<sub>Task: ${task.id}</sub>`;
      await edited(f, body);
      expect(await taskOf(task.id)).toMatchObject({
        description: "Task description",
      });
    });

    it("accepts a same-timestamp remote close matching historical outbound state", async () => {
      const f = await setup();
      const stamp = "2026-01-01T00:00:00Z";
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: {
          state: "open",
          lastSync: {
            state: outboundStamp(
              outboundStamp(undefined, "closed", stamp),
              "open",
              stamp,
            ),
          },
        },
      });
      serveIssue({ state: "closed" });
      await stateChange(f, "closed", stamp);
      expect(await taskOf(task.id)).toMatchObject({
        status: f.columns.done.slug,
      });
    });

    it("retains outbound stamps added after the initial inbound snapshot", async () => {
      const f = await setup();
      const stamp = outboundStamp(undefined, "New local title", "new-time");
      const { link } = await linkedTask(f, {
        number: 1,
        metadata: { marker: "preserve", lastSync: { title: stamp } },
      });
      await edited(f, payload());
      const stored = await app.db.findOneByOrFail(ExternalLinkEntity, {
        id: link.id,
      });
      const metadata = JSON.parse(stored.metadata!);
      expect(metadata.lastSync.title.outbound).toEqual(stamp.outbound);
      expect(metadata.marker).toBe("preserve");
    });

    it("recognizes a delayed echo whose stamp arrives before the locked reread", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: {
          lastSync: {
            title: outboundStamp(undefined, "Remote correction", undefined),
          },
        },
      });
      const body = payload();
      body.changes = { title: { from: "Old" } };
      await edited(f, body);
      expect(await taskOf(task.id)).toMatchObject({ title: "Task title" });
    });

    it("applies an ordinary complete webhook without consulting an unavailable provider", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: { lastSync: {} },
      });
      gitea.on("GET", issuePath(), () => ({ status: 500, body: {} }));
      await edited(f, payload());
      expect(gitea.calls("GET", issuePath())).toHaveLength(0);
      expect(await taskOf(task.id)).toMatchObject({
        title: "Remote correction",
        description: "Remote description",
      });
    });

    it("rechecks a close echo from the locked state snapshot", async () => {
      const f = await setup();
      const { task } = await linkedTask(f, {
        number: 1,
        metadata: { lastSync: { state: outboundStamp(undefined, "closed") } },
      });
      await stateChange(f, "closed");
      expect(await taskOf(task.id)).toMatchObject({
        status: f.columns.todo.slug,
      });
    });

    it("applies a close following an inbound reopen within the same provider timestamp", async () => {
      const f = await setup();
      const stamp = "2026-01-01T00:00:00Z";
      const { task, link } = await linkedTask(f, {
        number: 1,
        status: f.columns.done.slug,
        metadata: {
          state: "closed",
          lastSync: { state: outboundStamp(undefined, "closed", stamp) },
        },
      });
      const metadata = async () =>
        JSON.parse(
          (await app.db.findOneByOrFail(ExternalLinkEntity, { id: link.id }))
            .metadata!,
        );
      await stateChange(f, "open", stamp);
      expect((await metadata()).lastSync.state.value).toBe("open");
      expect(await taskOf(task.id)).toMatchObject({
        status: f.columns.todo.slug,
      });
      serveIssue({ state: "closed" });
      await stateChange(f, "closed", stamp);
      expect(await taskOf(task.id)).toMatchObject({
        status: f.columns.done.slug,
      });
      expect((await metadata()).state).toBe("closed");
    });
  });
});
