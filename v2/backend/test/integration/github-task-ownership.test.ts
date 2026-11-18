// Ported from tests/api-integration/integration-task-ownership.test.ts (GitHub and
// provider-neutral cases; the Gitea/GitLab import and webhook cases are in
// gitea-task-ownership.test.ts).
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
import { TaskEntity } from "../../src/database/entities/task.entity";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import { withIntegrationTask } from "../../src/integrations/links/integration-task-scope";
import { isOutboundEcho } from "../../src/integrations/links/sync-echo";
import { ProjectMoveService } from "../../src/project/project-move.service";
import { TaskMoveService } from "../../src/task/mutations/task-move.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertGitHubIntegration } from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const double = createGitHubAppDouble();
let app: TestApp;

beforeAll(async () => {
  app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  double.reset();
  vi.restoreAllMocks();
});

async function setup() {
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
  const integration = await insertGitHubIntegration(app.db, project.id);
  const link = await insertRow(app.db, ExternalLinkEntity, {
    taskId: task.id,
    integrationId: integration.id,
    resourceType: "issue",
    externalId: "1",
    url: "https://github.com/owner/repo/issues/1",
  });
  return { source, privateWorkspace, project, destination, task, integration, link };
}

const moveTask = (input: {
  taskId: string;
  destinationProjectId: string;
  currentUserId: string;
}) => app.get(TaskMoveService).moveTask(input);
const allLinks = () => app.db.find(ExternalLinkEntity);
const taskLinks = (taskId: string) =>
  app.db.findBy(ExternalLinkEntity, { taskId });

describe("integration task ownership", () => {
  // The Gitea/GitLab cases are in test/integration/gitea-task-ownership.test.ts.

  it("moving a task removes links to its previous project's integration atomically", async () => {
    const f = await setup();
    const manual = await insertRow(app.db, ExternalLinkEntity, {
      taskId: f.task.id,
      resourceType: "url",
      integrationId: null,
      url: "https://example.test/manual",
      externalId: "manual",
    });
    await moveTask({
      taskId: f.task.id,
      destinationProjectId: f.destination.id,
      currentUserId: f.source.user.id,
    });
    expect(await taskLinks(f.task.id)).toEqual([manual]);
  });

  it("moving a project removes legacy links owned by another project", async () => {
    const f = await setup();
    await app.db.update(
      TaskEntity,
      { id: f.task.id },
      { projectId: f.destination.id },
    );
    await app
      .get(ProjectMoveService)
      .moveProject(
        f.destination.id,
        f.source.workspace.id,
        f.privateWorkspace.workspace.id,
        f.source.user.id,
      );
    expect(await taskLinks(f.task.id)).toEqual([]);
  });

  it("a concurrent task move waits for scoped integration writes to commit", async () => {
    const f = await setup();
    let release!: () => void;
    let started!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sync = withIntegrationTask(
      app.db,
      f.task.id,
      { ...f.integration, project: f.project },
      async (tx) => {
        started();
        await barrier;
        await tx.update(
          TaskEntity,
          { id: f.task.id },
          { title: "Synced before moving" },
        );
      },
    );
    await ready;
    let moved = false;
    const move = moveTask({
      taskId: f.task.id,
      destinationProjectId: f.destination.id,
      currentUserId: f.source.user.id,
    }).then(() => {
      moved = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(moved).toBe(false);
    } finally {
      release();
    }
    await Promise.all([sync, move]);
    expect(
      await app.db.findOneByOrFail(TaskEntity, { id: f.task.id }),
    ).toMatchObject({
      projectId: f.destination.id,
      title: "Synced before moving",
    });
    expect(await taskLinks(f.task.id)).toEqual([]);
  });
});

it("reports a concurrent move as a conflict without deleting links", async () => {
  const f = await setup();
  const transaction = app.db.transaction.bind(app.db);
  vi.spyOn(app.db, "transaction").mockImplementationOnce(
    async (...args: unknown[]) => {
      await app.db.update(
        TaskEntity,
        { id: f.task.id },
        { projectId: f.destination.id },
      );
      return (transaction as (...args: unknown[]) => Promise<unknown>)(...args);
    },
  );
  await expect(
    moveTask({
      taskId: f.task.id,
      destinationProjectId: f.destination.id,
      currentUserId: f.source.user.id,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await allLinks()).toHaveLength(1);
});

it("preserves legacy links belonging to the destination integration when moving back", async () => {
  const f = await setup();
  const destinationIntegration = await insertRow(app.db, IntegrationEntity, {
    projectId: f.destination.id,
    type: "gitea",
    config: "{}",
  });
  const compatible = await insertRow(app.db, ExternalLinkEntity, {
    taskId: f.task.id,
    integrationId: destinationIntegration.id,
    resourceType: "issue",
    externalId: "legacy",
    url: "https://gitea.example/legacy",
  });
  await moveTask({
    taskId: f.task.id,
    destinationProjectId: f.destination.id,
    currentUserId: f.source.user.id,
  });
  expect(await allLinks()).toEqual([compatible]);
});

it("preserves outbound history and unrelated fields across concurrent sync completions", async () => {
  const { link } = await setup();
  await app.db.update(
    ExternalLinkEntity,
    { id: link.id },
    { metadata: JSON.stringify({ remoteMarker: "keep" }) },
  );
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      updateExternalLink(app.db, link.id, {
        outbound: {
          field: i % 2 ? "description" : "title",
          value: `edit-${i}`,
          updatedAt: `time-${i}`,
        },
      }),
    ),
  );
  const beforeStateWebhook = await app.db.findOneByOrFail(ExternalLinkEntity, {
    id: link.id,
  });
  const latestTitleStamp = JSON.parse(beforeStateWebhook.metadata!).lastSync
    .title;
  // A state webhook can hold a metadata snapshot predating every outbound write.
  await updateExternalLink(app.db, link.id, {
    metadata: {
      remoteMarker: "keep",
      state: "closed",
      lastSync: {
        title: {
          source: "github",
          value: "remote",
          timestamp: "2000-01-01T00:00:00Z",
          outbound: [],
        },
      },
    },
  });
  const saved = await app.db.findOneByOrFail(ExternalLinkEntity, {
    id: link.id,
  });
  const metadata = JSON.parse(saved.metadata!);
  expect(metadata.remoteMarker).toBe("keep");
  expect(metadata.lastSync.title).toEqual(latestTitleStamp);
  for (let i = 0; i < 12; i++)
    expect(
      isOutboundEcho(
        metadata.lastSync[i % 2 ? "description" : "title"],
        `edit-${i}`,
        `time-${i}`,
      ),
    ).toBe(true);
});

// The Gitea/GitLab cases are in test/integration/gitea-task-ownership.test.ts.
