// The Gitea and GitLab cases of
// tests/api-integration/integration-task-ownership.test.ts (the GitHub and
// provider-neutral cases are in github-task-ownership.test.ts). As there, the
// provider clients are mocked and events are not delivered.
import {
  afterAll,
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
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GiteaImportService } from "../../src/integrations/gitea/import/gitea-import.service";
import { handleGiteaIssueCommentCreated } from "../../src/integrations/gitea/webhooks/issue-comment-created";
import { handleGiteaIssueEdited } from "../../src/integrations/gitea/webhooks/issue-edited";
import { handleGiteaIssueLabeled } from "../../src/integrations/gitea/webhooks/issue-labeled";
import { GitlabImportService } from "../../src/integrations/gitlab/import/gitlab-import.service";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import {
  isOutboundEcho,
  outboundStamp,
} from "../../src/integrations/links/sync-echo";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import { TaskMoveService } from "../../src/task/mutations/task-move.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite spied on the module export; here the real function is
// wrapped so a test can count eligibility checks.
vi.mock("../../src/integrations/sync/eligibility", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/integrations/sync/eligibility")>();
  return { ...actual, canSyncTask: vi.fn(actual.canSyncTask) };
});

const m = vi.hoisted(() => ({
  listIssues: vi.fn(),
  getIssue: vi.fn(),
  listIssueComments: vi.fn(async () => [] as unknown[]),
  listIssueNotes: vi.fn(async () => [] as unknown[]),
  listPulls: vi.fn(async () => [] as unknown[]),
  listMergeRequests: vi.fn(async () => [] as unknown[]),
}));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => m,
}));
vi.mock("../../src/integrations/gitlab/client/gitlab-client", () => ({
  createGitlabClient: () => m,
}));

const remoteIssue = {
  number: 1,
  iid: 1,
  title: "Remote title",
  body: "Remote description",
  description: "Remote description",
  html_url: "https://gitea.example/owner/repo/issues/1",
  web_url: "https://gitlab.example/group/repo/-/issues/1",
  state: "open",
  labels: [],
};
const repository = {
  owner: { login: "owner" },
  name: "repo",
  html_url: "https://gitea.example/owner/repo",
};

let app: TestApp;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
  publish = vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
  vi.mocked(canSyncTask).mockClear();
  m.listIssues.mockReset().mockResolvedValue([remoteIssue]);
  m.getIssue.mockReset().mockResolvedValue(remoteIssue);
  m.listIssueComments.mockReset().mockResolvedValue([]);
  m.listIssueNotes.mockReset().mockResolvedValue([]);
  m.listPulls.mockReset().mockResolvedValue([]);
  m.listMergeRequests.mockReset().mockResolvedValue([]);
});

async function setup(type = "gitea") {
  const source = await createWorkspaceMember(app.db, { role: "owner" });
  const privateWorkspace = await createWorkspaceMember(app.db, {
    role: "owner",
  });
  const { project } = await createProjectFixture(app.db, {
    workspaceId: source.workspace.id,
  });
  const { project: destination } = await createProjectFixture(app.db, {
    workspaceId: source.workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    title: "Private title",
    description: "Private description",
    number: 1,
  });
  const integration = await insertRow(app.db, IntegrationEntity, {
    projectId: project.id,
    type,
    config: JSON.stringify({
      baseUrl: `https://${type}.example`,
      accessToken: "fake-test-token",
      repositoryOwner: "owner",
      repositoryName: "repo",
      projectPath: "group/repo",
    }),
  });
  const link = await insertRow(app.db, ExternalLinkEntity, {
    taskId: task.id,
    integrationId: integration.id,
    resourceType: "issue",
    externalId: "1",
    url: remoteIssue.html_url,
  });
  return {
    source,
    privateWorkspace,
    project,
    destination,
    task,
    integration,
    link,
  };
}

const importIssues = (type: string, projectId: string) =>
  type === "gitea"
    ? app.get(GiteaImportService).importIssues(projectId)
    : app.get(GitlabImportService).importIssues(projectId);

const moveTask = (input: {
  taskId: string;
  destinationProjectId: string;
  currentUserId: string;
}) => app.get(TaskMoveService).moveTask(input);

async function moveWithoutCleanup(fixture: Awaited<ReturnType<typeof setup>>) {
  // Reproduce links left by earlier releases, even after their new project
  // has moved into a private workspace.
  await app.db.update(
    TaskEntity,
    { id: fixture.task.id },
    { projectId: fixture.destination.id },
  );
  await app.db.update(
    ProjectEntity,
    { id: fixture.destination.id },
    { workspaceId: fixture.privateWorkspace.workspace.id },
  );
}

async function expectPrivateTask(taskId: string) {
  expect(await app.db.findOneByOrFail(TaskEntity, { id: taskId })).toMatchObject(
    { title: "Private title", description: "Private description" },
  );
  expect(await app.db.findBy(LabelEntity, { taskId })).toEqual([]);
  expect(await app.db.findBy(ActivityEntity, { taskId })).toEqual([]);
}

const editedPayload = () => ({
  action: "edited",
  issue: remoteIssue,
  repository,
  changes: {
    title: { from: "Private title" },
    body: { from: "Private description" },
  },
});
const labeledPayload = () => ({
  action: "labeled",
  issue: {
    number: 1,
    labels: [{ name: "priority:high" }, { name: "bug" }],
  },
  label: { name: "bug", color: "ff0000" },
  repository,
});
const commentPayload = () => ({
  action: "created",
  issue: { number: 1 },
  repository,
  comment: {
    id: 4,
    body: "Wrong workspace",
    html_url: `${remoteIssue.html_url}#comment-4`,
    user: { login: "author", avatar_url: "" },
    created_at: new Date().toISOString(),
  },
});

describe("integration task ownership", () => {
  it.each(["gitea", "gitlab"])(
    "%s imports new issues from formatted configuration JSON",
    async (type) => {
      const f = await setup(type);
      await app.db.update(
        ProjectEntity,
        { id: f.project.id },
        { lastTaskNumber: 1 },
      );
      await app.db.delete(ExternalLinkEntity, { id: f.link.id });
      await app.db.update(
        IntegrationEntity,
        { id: f.integration.id },
        { config: JSON.stringify(JSON.parse(f.integration.config), null, 2) },
      );
      expect(await importIssues(type, f.project.id)).toMatchObject({
        imported: 1,
        skipped: 0,
      });
    },
  );

  it.each(["gitea", "gitlab"])(
    "%s import cannot modify a moved task through an old link",
    async (type) => {
      const fixture = await setup(type);
      await moveWithoutCleanup(fixture);
      const result = await importIssues(type, fixture.project.id);
      expect(result.updated).toBe(0);
      await expectPrivateTask(fixture.task.id);
    },
  );

  it.each(["gitea", "gitlab"])(
    "%s comment fetching leaves task moves unlocked and rechecks scope afterwards",
    async (type) => {
      const f = await setup(type);
      const fetchComments =
        type === "gitea" ? m.listIssueComments : m.listIssueNotes;
      fetchComments.mockImplementationOnce(async () => {
        await moveTask({
          taskId: f.task.id,
          destinationProjectId: f.destination.id,
          currentUserId: f.source.user.id,
        });
        return [];
      });
      const result = await importIssues(type, f.project.id);
      expect(result.updated).toBe(0);
      await expectPrivateTask(f.task.id);
      expect(
        (await app.db.findOneByOrFail(TaskEntity, { id: f.task.id })).projectId,
      ).toBe(f.destination.id);
    },
  );

  it.each(["gitea", "gitlab"])(
    "%s import cannot revive a removed link after a task moves away and back",
    async (type) => {
      const f = await setup(type);
      const fetchComments =
        type === "gitea" ? m.listIssueComments : m.listIssueNotes;
      fetchComments.mockImplementationOnce(async () => {
        await moveTask({
          taskId: f.task.id,
          destinationProjectId: f.destination.id,
          currentUserId: f.source.user.id,
        });
        await moveTask({
          taskId: f.task.id,
          destinationProjectId: f.project.id,
          currentUserId: f.source.user.id,
        });
        return [];
      });
      const result = await importIssues(type, f.project.id);
      expect(result).toMatchObject({ updated: 0, skipped: 1 });
      await expectPrivateTask(f.task.id);
      expect(
        await app.db.findOneBy(ExternalLinkEntity, { id: f.link.id }),
      ).toBeNull();
    },
  );

  it("gitea edits, labels and comments cannot follow stale links", async () => {
    const f = await setup();
    await moveWithoutCleanup(f);
    const events = app.get(EventBus);
    await handleGiteaIssueEdited(
      app.db,
      events,
      editedPayload(),
      f.integration.id,
    );
    await handleGiteaIssueLabeled(
      app.db,
      events,
      labeledPayload(),
      f.integration.id,
    );
    await handleGiteaIssueCommentCreated(
      app.db,
      commentPayload(),
      f.integration.id,
    );
    await expectPrivateTask(f.task.id);
  });
});

it("keeps outbound history committed during an inbound provider read", async () => {
  const { link } = await setup();
  await app.db.update(
    ExternalLinkEntity,
    { id: link.id },
    {
      metadata: JSON.stringify({
        lastSync: {
          title: outboundStamp(
            outboundStamp(undefined, remoteIssue.title),
            "Latest local",
          ),
        },
      }),
    },
  );
  m.getIssue.mockImplementationOnce(async () => {
    await updateExternalLink(app.db, link.id, {
      outbound: {
        field: "title",
        value: "Local edit",
        updatedAt: "local-time",
      },
    });
    return remoteIssue;
  });
  await handleGiteaIssueEdited(app.db, app.get(EventBus), {
    action: "edited",
    repository,
    issue: remoteIssue,
    changes: { title: { from: "Old" } },
  });
  // The outbound metadata change invalidates the first provider confirmation.
  expect(m.getIssue).toHaveBeenCalledTimes(2);
  const saved = await app.db.findOneByOrFail(ExternalLinkEntity, {
    id: link.id,
  });
  expect(
    isOutboundEcho(
      JSON.parse(saved.metadata!).lastSync.title,
      "Local edit",
      "local-time",
    ),
  ).toBe(true);
});

it.each(["edit", "labels", "comment"])(
  "ignores a stale %s webhook after its link is removed during a move and return",
  async (kind) => {
    const f = await setup();
    const transaction = app.db.transaction.bind(app.db) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    vi.spyOn(app.db, "transaction").mockImplementationOnce((async (
      ...args: unknown[]
    ) => {
      await moveTask({
        taskId: f.task.id,
        destinationProjectId: f.destination.id,
        currentUserId: f.source.user.id,
      });
      await moveTask({
        taskId: f.task.id,
        destinationProjectId: f.project.id,
        currentUserId: f.source.user.id,
      });
      return transaction(...args);
    }) as never);
    const events = app.get(EventBus);
    if (kind === "edit")
      await handleGiteaIssueEdited(
        app.db,
        events,
        editedPayload(),
        f.integration.id,
      );
    if (kind === "labels")
      await handleGiteaIssueLabeled(
        app.db,
        events,
        labeledPayload(),
        f.integration.id,
      );
    if (kind === "comment")
      await handleGiteaIssueCommentCreated(
        app.db,
        commentPayload(),
        f.integration.id,
      );
    await expectPrivateTask(f.task.id);
  },
);

it.each(["gitea", "gitlab"])(
  "announces committed %s reimport updates to task and resource caches",
  async (provider) => {
    const fixture = await setup(provider);
    const checks: Promise<void>[] = [];
    publish.mockImplementation(async (type, data) => {
      if (
        !["task.updated", "task.labels_updated", "comment.updated"].includes(
          type,
        )
      )
        return;
      expect(data).toEqual({
        projectId: fixture.project.id,
        taskId: fixture.task.id,
      });
      const check = app.db
        .findOneByOrFail(TaskEntity, { id: fixture.task.id })
        .then((task) =>
          expect(task).toMatchObject({
            title: "Remote title",
            description: "Remote description",
          }),
        );
      checks.push(check);
      await check;
    });
    const result = await importIssues(provider, fixture.project.id);
    await Promise.all(checks);
    expect(result).toMatchObject({ imported: 0, updated: 1 });
    expect(publish.mock.calls.map(([type]) => type)).toEqual([
      "task.updated",
      "task.labels_updated",
      "comment.updated",
    ]);
  },
);

it("does not apply a webhook after its link is paused while waiting for the link lock", async () => {
  const f = await setup();
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const guard = vi.mocked(canSyncTask);
  const pause = app.dataSource.transaction(async (tx) => {
    await tx.query(`SELECT id FROM external_link WHERE id = $1 FOR UPDATE`, [
      f.link.id,
    ]);
    await tx.query(`UPDATE external_link SET metadata = $2 WHERE id = $1`, [
      f.link.id,
      JSON.stringify({ syncFilterPaused: true }),
    ]);
    locked();
    await gate;
  });
  await acquired;
  guard.mockClear();
  const webhook = handleGiteaIssueEdited(
    app.db,
    app.get(EventBus),
    editedPayload(),
    f.integration.id,
  );
  try {
    await vi.waitFor(async () => {
      const [waiting] = (await app.db.query(`
        select exists (
          select 1 from pg_stat_activity
          where datname = current_database()
            and wait_event_type = 'Lock'
            and query like '%external_link%'
        ) as blocked
      `)) as { blocked: boolean }[];
      expect(waiting?.blocked).toBe(true);
    });
    expect(guard).not.toHaveBeenCalled();
    release();
    await pause;
    await webhook;
    expect(guard).toHaveBeenCalledOnce();
    await expectPrivateTask(f.task.id);
  } finally {
    release();
    await pause;
    await webhook;
  }
});
