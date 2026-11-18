// Ported from tests/api-integration/github-import-bounds.test.ts.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { GithubImportEntity } from "../../src/database/entities/github-import.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { getPgPool } from "../../src/database/pg-pool";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";

import { GitHubImportLock } from "../../src/integrations/github/import/github-import-lock";
import { GitHubImportService } from "../../src/integrations/github/import/github-import.service";
import { IMPORT_PAGES_PER_REQUEST } from "../../src/integrations/github/import/import-pages";
import { handleIssueOpened } from "../../src/integrations/github/webhooks/issue-opened";
import { TaskMoveService } from "../../src/task/mutations/task-move.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertGitHubIntegration } from "../support/fixtures/github-fixtures";
import {
  connection,
  deferred,
  emptyPulls,
  importGitHubConfig,
  importedComment as comment,
  importedIssue as issue,
  importedLabel as label,
  issuePage,
  OLD_GITHUB_DATE as old,
  pullsPage,
} from "../support/fixtures/github-import-pages";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { createTestApp, type TestApp } from "../support/test-app";

type PublishedPayload = { projectId: string; taskId?: string };

const double = createGitHubAppDouble();
const graphql = double.octokit.graphql;
let app: TestApp;
let publish: MockInstance<EventBus["publish"]>;

function serveIssues(count: number) {
  graphql.mockImplementation(
    async (query: string, variables: { cursor: string | null }) => {
      if (query.includes("query ImportPullRequests(")) return emptyPulls();
      const number = Number(variables.cursor ?? 0) + 1;
      return issuePage([issue(number)], number < count, String(number), count);
    },
  );
}

beforeAll(async () => {
  app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  double.reset();
  // The previous suite replaced publishEvent with a mock: nothing is delivered.
  publish = vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});
afterEach(() => publish.mockRestore());

async function setup() {
  const member = await createWorkspaceMember(app.db, { role: "admin" });
  const { project, columns } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  const config = importGitHubConfig(member.user.id, {
    commentTaskLinkOnGitHubIssue: false,
  });
  const integration = await insertGitHubIntegration(app.db, project.id, config);
  app.auth.signIn(member.user);
  const request = (runId?: string) =>
    app.request("/api/github-integration/import-issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        ...(runId ? { runId } : {}),
      }),
    });
  return { member, project, columns, integration, config, request };
}
const importIssues = (projectId: string, runId?: string) =>
  app.get(GitHubImportService).importIssues(projectId, runId);
const saved = () => app.db.findOne(GithubImportEntity, { where: {} });
const setConfig = (id: string, config: unknown) =>
  app.db.update(IntegrationEntity, { id }, { config: JSON.stringify(config) });
const tasks = () => app.db.find(TaskEntity);
const links = () => app.db.find(ExternalLinkEntity);
const activities = () => app.db.find(ActivityEntity);
const allLabels = () => app.db.find(LabelEntity);

describe("bounded resumable GitHub import", () => {
  it.each([false, true])(
    "fails closed for invalid stored rules (linked=%s)",
    async (linked) => {
      const { project, integration, config, request } = await setup();
      if (linked) {
        const task = await createTask(app.db, {
          projectId: project.id,
          title: "Existing task",
          number: 1,
          status: "to-do",
        });
        await insertRow(app.db, ExternalLinkEntity, {
          taskId: task.id,
          integrationId: integration.id,
          resourceType: "issue",
          externalId: "1",
          url: "https://github.com/example/repo/issues/1",
        });
      }
      await setConfig(integration.id, {
        ...config,
        syncRules: {
          outgoing: { mode: "all" },
          incoming: { mode: "labels", match: "any", labels: [] },
        },
      });
      serveIssues(1);
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ imported: 0, skipped: 1 });
      const storedTasks = await tasks();
      const storedLinks = await links();
      expect(storedTasks).toHaveLength(linked ? 1 : 0);
      expect(storedLinks).toHaveLength(linked ? 1 : 0);
      if (linked) {
        expect(storedTasks[0]?.title).toBe("Existing task");
        expect(JSON.parse(storedLinks[0]!.metadata!)).toMatchObject({
          syncFilterPaused: true,
        });
      }
    },
  );

  it("preserves provider colors when rule checks import labels before the page", async () => {
    const { member, integration, config, request } = await setup();
    await insertRow(app.db, LabelEntity, {
      workspaceId: member.workspace.id,
      name: "workspace",
      color: "#123456",
    });
    await setConfig(integration.id, {
      ...config,
      syncRules: {
        outgoing: { mode: "all" },
        incoming: { mode: "labels", match: "any", labels: ["approved"] },
      },
    });
    const labels = [
      { name: "approved", color: "abcdef" },
      { name: "workspace", color: "fedcba" },
    ];
    double.octokit.rest.issues.get.mockResolvedValue({
      data: {
        labels: [...labels, { name: "scope-only", color: "#654321" }, "no-color"],
      },
    });
    graphql.mockImplementation(async (query: string) =>
      query.includes("query ImportIssues(")
        ? issuePage([issue(1, { labels: connection(labels) })])
        : emptyPulls(),
    );
    expect((await request()).status).toBe(200);
    const link = (await links())[0]!;
    const assigned = await app.db.find(LabelEntity, {
      where: { taskId: link.taskId },
    });
    expect(
      Object.fromEntries(assigned.map(({ name, color }) => [name, color])),
    ).toEqual({
      approved: "#abcdef",
      workspace: "#123456",
      "scope-only": "#654321",
      "no-color": "#6B7280",
    });
  });

  it("pauses a newly imported issue that misses the outgoing rule before announcing it", async () => {
    const { member, integration, config, request } = await setup();
    const root = await insertRow(app.db, LabelEntity, {
      workspaceId: member.workspace.id,
      name: "export",
      color: "red",
    });
    await setConfig(integration.id, {
      ...config,
      syncRules: {
        outgoing: { mode: "labels", match: "any", labels: [root.id] },
        incoming: { mode: "all" },
      },
    });
    double.octokit.rest.issues.get.mockResolvedValue({ data: { labels: [] } });
    serveIssues(1);
    expect((await request()).status).toBe(200);
    const link = (await links())[0]!;
    expect(JSON.parse(link.metadata!)).toMatchObject({
      syncFilterPaused: true,
    });
  });

  it.each(["new", "legacy-new", "legacy-existing"])(
    "preserves %s issue history across import requests",
    async (history) => {
      const { member, project, integration, config } = await setup();
      const existing = history === "legacy-existing";
      if (existing) {
        const task = await createTask(app.db, {
          projectId: project.id,
          number: 1,
          title: "Existing imported task",
          status: "to-do",
        });
        await insertRow(app.db, ExternalLinkEntity, {
          taskId: task.id,
          integrationId: integration.id,
          resourceType: "issue",
          externalId: "1",
          url: "https://github.com/example/repo/issues/1",
          createdAt: new Date(old),
          metadata: JSON.stringify({ createdFrom: "github-import" }),
        });
      }
      const root = await insertRow(app.db, LabelEntity, {
        workspaceId: member.workspace.id,
        name: "export",
        color: "red",
      });
      await setConfig(integration.id, {
        ...config,
        syncRules: {
          outgoing: existing
            ? { mode: "all" }
            : { mode: "labels", match: "any", labels: [root.id] },
          incoming: { mode: "all" },
        },
      });
      double.octokit.rest.issues.get.mockResolvedValue({
        data: { labels: [] },
      });
      const comments = Array.from({ length: 85 }, (_, index) => comment(index));
      graphql.mockImplementation(
        async (query: string, vars: { cursor: string | null }) => {
          if (query.includes("query ImportIssues("))
            return issuePage([
              issue(1, {
                comments: connection(
                  comments.slice(0, 20),
                  true,
                  "20",
                  comments.length,
                ),
              }),
            ]);
          if (query.includes("query ImportIssueComments(")) {
            const start = Number(vars.cursor);
            const end = Math.min(start + 20, comments.length);
            return {
              repository: {
                databaseId: 2,
                issue: {
                  comments: connection(
                    comments.slice(start, end),
                    end < comments.length,
                    String(end),
                    comments.length,
                  ),
                },
              },
            };
          }
          return emptyPulls();
        },
      );
      let result = await importIssues(project.id);
      expect(result).toMatchObject({
        pending: true,
        imported: existing ? 0 : 1,
        updated: existing ? 1 : 0,
        skipped: 0,
      });
      expect(
        JSON.parse((await links())[0]!.metadata!).syncFilterPaused === true,
      ).toBe(!existing);
      const initialComments = (await activities()).length;
      if (history !== "new") {
        const persisted = (await saved())!;
        delete persisted.state.currentIssue!.isNewTask;
        await app.db.update(
          GithubImportEntity,
          { integrationId: integration.id },
          { state: persisted.state },
        );
      }
      if (existing)
        await setConfig(integration.id, {
          ...config,
          syncRules: {
            outgoing: { mode: "labels", match: "any", labels: [root.id] },
            incoming: { mode: "all" },
          },
        });
      result = await importIssues(project.id, result.runId);
      expect(result).toMatchObject({
        pending: false,
        imported: existing ? 0 : 1,
        updated: existing ? 1 : 0,
        skipped: existing ? 1 : 0,
      });
      expect(await activities()).toHaveLength(
        existing ? initialComments : comments.length,
      );
      expect(JSON.parse((await links())[0]!.metadata!)).toMatchObject({
        syncFilterPaused: true,
      });
      expect(await importIssues(project.id)).toMatchObject({
        pending: false,
        imported: 0,
        skipped: 1,
      });
      expect(await activities()).toHaveLength(
        existing ? initialComments : comments.length,
      );
    },
  );

  it("rejects an incoming rule change while fetching a page before creating tasks or consuming its cursor", async () => {
    const { integration, config, request } = await setup();
    const started = deferred();
    const release = deferred();
    graphql.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return issuePage([issue(1)], true, "first", 2);
    });
    const importing = request();
    await started.promise;
    await setConfig(integration.id, {
      ...config,
      syncRules: {
        outgoing: { mode: "all" },
        incoming: { mode: "labels", labels: ["approved"], match: "any" },
      },
    });
    release.resolve();
    expect((await importing).status).toBe(409);
    expect(await tasks()).toHaveLength(0);
    expect(await links()).toHaveLength(0);
    expect((await saved())?.state).toMatchObject({
      phase: "issues",
      issueCursor: null,
      imported: 0,
    });
  });

  it("bounds each HTTP step, persists resumable state, imports every issue and retries completion without restarting", async () => {
    const { request, project } = await setup();
    serveIssues(9);
    const observedCounts: number[] = [];
    publish.mockImplementation(async (name, data) => {
      const payload = data as PublishedPayload;
      if (name === "project.updated") {
        expect(payload).toEqual({ projectId: project.id });
        observedCounts.push((await tasks()).length);
      } else {
        expect(
          await app.db.findOne(TaskEntity, { where: { id: payload.taskId! } }),
        ).not.toBeNull();
      }
    });
    const first = await request();
    expect(first.status).toBe(202);
    const progress = (await first.json()) as { runId: string };
    expect(progress).toMatchObject({
      pending: true,
      imported: IMPORT_PAGES_PER_REQUEST,
      updated: 0,
    });
    expect(graphql).toHaveBeenCalledTimes(IMPORT_PAGES_PER_REQUEST);
    expect(observedCounts).toEqual([1, 2, 3, 4]);
    const info = await app.request(
      `/api/github-integration/project/${project.id}`,
    );
    expect(
      ((await info.json()) as { importProgress: unknown }).importProgress,
    ).toEqual(progress);
    let response = await request(progress.runId);
    expect(response.status).toBe(202);
    response = await request(progress.runId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      pending: false,
      imported: 9,
    });
    expect(await tasks()).toHaveLength(9);
    expect(await links()).toHaveLength(9);
    const calls = graphql.mock.calls.length;
    expect((await request(progress.runId)).status).toBe(200);
    expect(graphql).toHaveBeenCalledTimes(calls);
    expect(await app.db.find(GithubImportEntity)).toHaveLength(1);
    expect(double.github.verifiedInstallationOctokit).toHaveBeenCalledWith(
      expect.anything(),
      true,
    );
  });

  it("resumes after provider failure without replaying committed pages or leaking provider errors", async () => {
    const { request, project } = await setup();
    serveIssues(7);
    const original = graphql.getMockImplementation();
    if (!original) throw new Error("Expected provider mock");
    graphql.mockImplementation(async (query, vars) => {
      if (vars.cursor === "2") throw new Error("private-token-provider-url");
      return original(query, vars);
    });
    const failed = await request();
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("private-token");
    expect(await tasks()).toHaveLength(2);
    expect((await saved())?.state).toMatchObject({
      imported: 2,
      issueCursor: "2",
    });
    graphql.mockImplementation(original);
    let result = await importIssues(project.id);
    while (result.pending) result = await importIssues(project.id, result.runId);
    expect(result).toMatchObject({ imported: 7, updated: 0 });
    expect(await tasks()).toHaveLength(7);
  });

  it("processes all label and comment pages, applies late system labels and deduplicates comments on reimport", async () => {
    const { project, columns } = await setup();
    const labels = Array.from({ length: 27 }, (_, n) => label(n));
    labels[25] = { name: "status:in-progress", color: "ffffff" };
    labels[26] = { name: "priority:urgent", color: "ffffff" };
    const comments = Array.from({ length: 85 }, (_, n) => comment(n));
    comments[2] = comment(2, {
      author: {
        login: "robot",
        avatarUrl: "https://example.test/a",
        __typename: "Bot",
      },
    });
    comments[3] = comment(3, {
      author: {
        login: "robot[bot]",
        avatarUrl: "https://example.test/a",
        __typename: "User",
      },
    });
    comments[84] = comment(84, { createdAt: "2099-01-01T00:00:00Z" });
    graphql.mockImplementation(
      async (query: string, vars: { cursor: string | null }) => {
        if (query.includes("query ImportIssues("))
          return issuePage([
            issue(1, {
              labels: connection(labels.slice(0, 25), true, "25", 27),
              comments: connection(comments.slice(0, 20), true, "20", 85),
            }),
          ]);
        if (query.includes("query ImportIssueLabels("))
          return {
            repository: {
              databaseId: 2,
              issue: { labels: connection(labels.slice(25), false, "27", 27) },
            },
          };
        if (query.includes("query ImportIssueComments(")) {
          const offset = Number(vars.cursor);
          const end = Math.min(85, offset + 20);
          return {
            repository: {
              databaseId: 2,
              issue: {
                comments: connection(
                  comments.slice(offset, end),
                  end < 85,
                  String(end),
                  85,
                ),
              },
            },
          };
        }
        return emptyPulls();
      },
    );
    const delivered: Array<{
      name: string;
      priority?: string | null;
      labels: number;
      comments: number;
    }> = [];
    publish.mockImplementation(async (name, data) => {
      const payload = data as PublishedPayload;
      if (!payload.taskId) return;
      const committed = await app.db.findOne(TaskEntity, {
        where: { id: payload.taskId },
      });
      delivered.push({
        name,
        priority: committed?.priority,
        labels: (await allLabels()).length,
        comments: (await activities()).length,
      });
    });
    let result = await importIssues(project.id);
    expect(result.pending).toBe(true);
    expect((await saved())?.state).toMatchObject({
      phase: "comments",
      currentIssue: { commentCursor: "60", labelsRemaining: 0 },
    });
    result = await importIssues(project.id, result.runId);
    expect(result.pending).toBe(false);
    expect(await allLabels()).toHaveLength(25);
    expect(await activities()).toHaveLength(82);
    expect(delivered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "task.labels_updated",
          priority: "urgent",
          labels: 25,
        }),
        expect.objectContaining({ name: "comment.updated", comments: 82 }),
      ]),
    );
    expect((await tasks())[0]).toMatchObject({
      priority: "urgent",
      status: "in-progress",
      columnId: columns.inProgress.id,
    });
    result = await importIssues(project.id);
    while (result.pending) result = await importIssues(project.id, result.runId);
    expect(result).toMatchObject({ imported: 0, updated: 1 });
    expect(await activities()).toHaveLength(82);
    expect(await allLabels()).toHaveLength(25);
  });

  it("does not chase comments added after the initial count or issues after the import boundary", async () => {
    const { project } = await setup();
    graphql.mockImplementation(async (query: string) => {
      if (query.includes("query ImportIssues("))
        return issuePage([
          issue(1, {
            comments: connection(
              Array.from({ length: 20 }, (_, n) => comment(n)),
              true,
              "20",
              21,
            ),
          }),
        ]);
      if (query.includes("query ImportIssueComments("))
        return {
          repository: {
            databaseId: 2,
            issue: {
              comments: connection(
                Array.from({ length: 20 }, (_, n) => comment(20 + n)),
                true,
                "40",
                99999,
              ),
            },
          },
        };
      return emptyPulls();
    });
    expect(await importIssues(project.id)).toMatchObject({
      pending: false,
      imported: 1,
    });
    expect(await activities()).toHaveLength(21);
    graphql.mockImplementation(async (query: string) =>
      query.includes("query ImportIssues(")
        ? issuePage(
            [issue(2, { createdAt: "2099-01-01T00:00:00Z" })],
            true,
            "2",
            999,
          )
        : emptyPulls(),
    );
    expect(await importIssues(project.id)).toMatchObject({
      pending: false,
      imported: 0,
    });
    expect(await tasks()).toHaveLength(1);
  });

  it("rolls back task, link, comments, number allocation and cursor together when saving progress fails", async () => {
    const { project } = await setup();
    serveIssues(1);
    await app.dataSource.query(
      `CREATE FUNCTION fail_import_progress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`,
    );
    await app.dataSource.query(
      "CREATE TRIGGER fail_import_progress BEFORE UPDATE ON github_import FOR EACH ROW EXECUTE FUNCTION fail_import_progress()",
    );
    try {
      await expect(importIssues(project.id)).rejects.toThrow();
      expect(await tasks()).toHaveLength(0);
      expect(await links()).toHaveLength(0);
      expect((await saved())?.state).toMatchObject({
        phase: "issues",
        issueCursor: null,
        imported: 0,
      });
      expect(
        await app.db.findOne(ProjectEntity, { where: { id: project.id } }),
      ).toMatchObject({ lastTaskNumber: 0 });
    } finally {
      await app.dataSource.query(
        "DROP TRIGGER fail_import_progress ON github_import",
      );
      await app.dataSource.query("DROP FUNCTION fail_import_progress()");
    }
    expect(await importIssues(project.id)).toMatchObject({
      imported: 1,
      pending: false,
    });
    expect((await tasks())[0]).toMatchObject({ number: 1 });
  });

  it("rechecks workspace access on every continuation and keeps state scoped to its integration", async () => {
    const { request, project } = await setup();
    serveIssues(7);
    const first = (await (await request()).json()) as { runId: string };
    const calls = graphql.mock.calls.length;
    const other = await createWorkspaceMember(app.db, { role: "admin" });
    app.auth.signIn(other.user);
    expect((await request(first.runId)).status).toBe(404);
    expect(
      (await app.request(`/api/github-integration/project/${project.id}`))
        .status,
    ).toBe(404);
    expect(graphql).toHaveBeenCalledTimes(calls);
  });

  it("rejects wrong run IDs and changed repository identities without consuming old cursors", async () => {
    const { project, integration, config } = await setup();
    serveIssues(7);
    const first = await importIssues(project.id);
    await expect(importIssues(project.id, "not-this-run")).rejects.toMatchObject(
      { status: 409 },
    );
    await setConfig(integration.id, { ...config, repositoryId: 22 });
    await expect(importIssues(project.id, first.runId)).rejects.toMatchObject({
      status: 409,
    });
    expect(graphql).toHaveBeenCalledTimes(4);
  });

  it("does not commit a fetched page after the integration is disabled", async () => {
    const { project, integration } = await setup();
    graphql.mockImplementation(async () => {
      await app.db.update(
        IntegrationEntity,
        { id: integration.id },
        { isActive: false },
      );
      return issuePage([issue(1)]);
    });
    await expect(importIssues(project.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(await tasks()).toHaveLength(0);
  });

  it.each(["identity", "cursor", "oversized"])(
    "rejects invalid provider %s without advancing saved progress",
    async (kind) => {
      const { project } = await setup();
      graphql.mockResolvedValue(
        kind === "identity"
          ? issuePage([issue(1)], false, null, 1, 99)
          : kind === "cursor"
            ? issuePage([issue(1)], true, null)
            : issuePage([issue(1), issue(2)]),
      );
      await expect(importIssues(project.id)).rejects.toMatchObject({
        status: kind === "identity" ? 409 : 502,
      });
      expect((await saved())?.state.imported).toBe(0);
      expect(await tasks()).toHaveLength(0);
    },
  );

  it("pauses on an empty unfinished page instead of silently dropping remaining issues", async () => {
    const { project } = await setup();
    graphql.mockResolvedValue(issuePage([], true, "next", 10));
    await expect(importIssues(project.id)).rejects.toMatchObject({
      status: 502,
    });
    expect((await saved())?.state).toMatchObject({
      imported: 0,
      issueCursor: null,
    });
  });

  it("does not loop on a repeated cursor and retains earlier pages", async () => {
    const { project } = await setup();
    graphql.mockResolvedValue(issuePage([issue(1)], true, "same", 100));
    await expect(importIssues(project.id)).rejects.toMatchObject({
      status: 502,
    });
    expect(graphql).toHaveBeenCalledTimes(2);
    expect((await saved())?.state).toMatchObject({
      imported: 1,
      issueCursor: "same",
    });
    expect(await tasks()).toHaveLength(1);
  });

  it("finishes a disappeared source without losing other issues or modifying another project's task", async () => {
    const { project } = await setup();
    graphql.mockImplementation(
      async (query: string, vars: { cursor: string | null }) => {
        if (query.includes("query ImportIssues("))
          return vars.cursor
            ? issuePage([issue(2)])
            : issuePage(
                [
                  issue(1, {
                    comments: connection([comment(1)], true, "first", 100),
                  }),
                ],
                true,
                "1",
                2,
              );
        if (query.includes("query ImportIssueComments("))
          return { repository: { databaseId: 2, issue: null } };
        return emptyPulls();
      },
    );
    expect(await importIssues(project.id)).toMatchObject({
      pending: false,
      imported: 2,
      skipped: 1,
    });
    expect(await tasks()).toHaveLength(2);
  });

  it("deleting an integration removes its saved progress but preserves imported tasks", async () => {
    const { project, integration } = await setup();
    serveIssues(8);
    await importIssues(project.id);
    await app.db.delete(IntegrationEntity, { id: integration.id });
    expect(await saved()).toBeNull();
    expect(await tasks()).toHaveLength(4);
  });

  it("limits simultaneous imports across processes and releases slots after failure", async () => {
    const lock = app.get(GitHubImportLock);
    const client = await getPgPool(app.dataSource).connect();
    await client.query(
      "SELECT pg_advisory_lock(773623, 0), pg_advisory_lock(773623, 1)",
    );
    try {
      await expect(lock.run("any", async () => {})).rejects.toMatchObject({
        status: 429,
      });
    } finally {
      await client.query("SELECT pg_advisory_unlock_all()");
      client.release();
    }
    await expect(
      lock.run("any", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(await lock.run("any", async () => "free")).toBe("free");
  });

  it("rejects overlapping steps for one project and permits later continuation", async () => {
    const { project, request } = await setup();
    serveIssues(1);
    const gate = deferred();
    const started = deferred();
    const original = graphql.getMockImplementation();
    if (!original) throw new Error("Expected provider mock");
    graphql.mockImplementation(async (query, vars) => {
      started.resolve();
      await gate.promise;
      return original(query, vars);
    });
    const first = importIssues(project.id);
    await started.promise;
    try {
      const busy = await request();
      expect(busy.status).toBe(429);
      expect(busy.headers.get("Retry-After")).toBe("1");
    } finally {
      gate.resolve();
    }
    expect(await first).toMatchObject({ pending: false, imported: 1 });
  });

  const openedPayload = (number: number, title: string) => ({
    action: "opened",
    installation: { id: 1 },
    repository: {
      id: 2,
      owner: { login: "example" },
      name: "repo",
      full_name: "example/repo",
    },
    issue: {
      number,
      title,
      body: "Description",
      html_url: `https://github.com/example/repo/issues/${number}`,
      user: null,
    },
  });

  it("coordinates webhook creation with imports so both paths create only one task and link", async () => {
    const { project } = await setup();
    serveIssues(1);
    const deps = githubDepsOf(app);
    const payload = openedPayload(1, "Issue 1");
    await Promise.all([
      importIssues(project.id),
      handleIssueOpened(deps, payload),
      handleIssueOpened(deps, payload),
    ]);
    expect(await tasks()).toHaveLength(1);
    expect(await links()).toHaveLength(1);
    expect(double.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("announces a webhook task only after its task and link commit", async () => {
    const { project } = await setup();
    publish.mockImplementation(async (name, data) => {
      const payload = data as PublishedPayload;
      expect(name).toBe("task.created");
      expect(payload).toMatchObject({
        projectId: project.id,
        title: "Live issue",
        description: "Description",
        priority: "low",
        status: "to-do",
        number: 1,
        userId: "",
        source: "github",
        externalId: "77",
        actor: "github-webhook",
      });
      const task = await app.db.findOne(TaskEntity, {
        where: { id: payload.taskId! },
      });
      const link = await app.db.findOne(ExternalLinkEntity, {
        where: { taskId: payload.taskId! },
      });
      expect(task?.title).toBe("Live issue");
      expect(link?.externalId).toBe("77");
    });
    await handleIssueOpened(
      githubDepsOf(app),
      openedPayload(77, "Live issue"),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it.each(["excluded", "paused"])(
    "imports pull request links for tasks with %s issue sync",
    async (scope) => {
      const { project, integration, config } = await setup();
      const task = await createTask(app.db, {
        projectId: project.id,
        number: 1,
        title: "Existing task",
        status: "to-do",
      });
      if (scope === "excluded")
        await setConfig(integration.id, {
          ...config,
          syncRules: {
            outgoing: { mode: "labels", match: "any", labels: ["missing"] },
            incoming: { mode: "all" },
          },
        });
      else
        await insertRow(app.db, ExternalLinkEntity, {
          taskId: task.id,
          integrationId: integration.id,
          resourceType: "issue",
          externalId: "1",
          url: "https://github.com/example/repo/issues/1",
          metadata: JSON.stringify({ syncFilterPaused: true }),
        });
      graphql.mockImplementation(async (query: string) => {
        if (query.includes("query ImportIssues(")) return issuePage([]);
        return pullsPage([
          {
            number: 5,
            title: `${project.slug.toUpperCase()}-1`,
            body: null,
            url: "https://github.com/example/repo/pull/5",
            state: "OPEN",
            createdAt: old,
            headRefName: `${project.slug.toLowerCase()}-1`,
            author: null,
          },
        ]);
      });
      expect((await importIssues(project.id)).pending).toBe(false);
      expect(
        await app.db.findOne(ExternalLinkEntity, {
          where: { resourceType: "pull_request" },
        }),
      ).toMatchObject({
        taskId: task.id,
        integrationId: integration.id,
        externalId: "5",
      });
    },
  );

  it("continues all pull request pages and links only matching tasks in this project", async () => {
    const { project, integration } = await setup();
    graphql.mockImplementation(
      async (query: string, vars: { cursor: string | null }) => {
        if (query.includes("query ImportIssues(")) return issuePage([issue(1)]);
        const offset = Number(vars.cursor ?? 0);
        const end = Math.min(25, offset + 10);
        const pulls = Array.from({ length: end - offset }, (_, index) => ({
          number: offset + index + 1,
          title: `${project.slug.toUpperCase()}-1`,
          body: null,
          url: `https://github.com/example/repo/pull/${offset + index + 1}`,
          state: "OPEN",
          createdAt: old,
          headRefName: `${project.slug.toLowerCase()}-1`,
          author: null,
        }));
        return pullsPage(pulls, end < 25, String(end), 25);
      },
    );
    const result = await importIssues(project.id);
    expect(result.pending).toBe(false);
    expect(
      await app.db.find(ExternalLinkEntity, {
        where: { resourceType: "pull_request", integrationId: integration.id },
      }),
    ).toHaveLength(25);
  });
});

it.each(["labels", "comments"])(
  "skips unlinked GitHub %s continuation data after a task moves away and back",
  async (phase) => {
    const { project, member } = await setup();
    const { project: destination } = await createProjectFixture(app.db, {
      workspaceId: project.workspaceId,
    });
    const moves = app.get(TaskMoveService);
    let movedTaskId: string | undefined;
    graphql.mockImplementation(async (query: string) => {
      if (query.includes("query ImportIssues("))
        return issuePage([
          issue(
            1,
            phase === "labels"
              ? { labels: connection([label(1)], true, "first", 2) }
              : { comments: connection([comment(1)], true, "first", 2) },
          ),
        ]);
      if (
        query.includes(
          phase === "labels"
            ? "query ImportIssueLabels("
            : "query ImportIssueComments(",
        )
      ) {
        const task = await app.db.findOne(TaskEntity, {
          where: { projectId: project.id },
        });
        movedTaskId = task!.id;
        await moves.moveTask({
          taskId: task!.id,
          destinationProjectId: destination.id,
          currentUserId: member.user.id,
        });
        await moves.moveTask({
          taskId: task!.id,
          destinationProjectId: project.id,
          currentUserId: member.user.id,
        });
        return {
          repository: {
            databaseId: 2,
            issue:
              phase === "labels"
                ? {
                    labels: connection([
                      { name: "status:in-progress", color: "ffffff" },
                      label(2),
                    ]),
                  }
                : { comments: connection([comment(2)]) },
          },
        };
      }
      return emptyPulls();
    });
    expect(await importIssues(project.id)).toMatchObject({
      pending: false,
      skipped: 1,
    });
    const stored = await app.db.findOne(TaskEntity, {
      where: { id: movedTaskId! },
    });
    expect(stored?.status).toBe("to-do");
    expect(
      await app.db.find(ExternalLinkEntity, { where: { taskId: movedTaskId! } }),
    ).toEqual([]);
    const taskLabels = await app.db.find(LabelEntity, {
      where: { taskId: movedTaskId! },
    });
    expect(taskLabels.some((row) => row.name === "label-2")).toBe(false);
    const taskComments = await app.db.find(ActivityEntity, {
      where: { taskId: movedTaskId! },
    });
    expect(
      taskComments.some((row) => row.externalUrl === comment(2).url),
    ).toBe(false);
  },
);
