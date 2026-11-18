// Ported from tests/api-integration/deferred-issue-edits.test.ts.
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { SelectQueryBuilder } from "typeorm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  type MockInstance,
  type TestContext,
  vi,
} from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { WorkflowRuleEntity } from "../../src/database/entities/workflow-rule.entity";
import { EventBus } from "../../src/events/event-bus";
import { DeferredIssueEditProviders } from "../../src/integrations/git-shared/deferred-issue-edit-providers";
import { DeferredIssueEditsJob } from "../../src/integrations/git-shared/deferred-issue-edits.job";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { GITHUB_DEPS, type GitHubDeps } from "../../src/integrations/github/github-deps";
import { handleIssueEdited } from "../../src/integrations/github/webhooks/issue-edited";
import { handleIssueStateChanged } from "../../src/integrations/github/webhooks/issue-state-changed";
import {
  deferIssueEdit,
  deferTaskSync,
} from "../../src/integrations/links/defer-issue-edit";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import { formatIssueBody } from "../../src/integrations/links/issue-format";
import {
  inboundStamp,
  outboundStamp,
} from "../../src/integrations/links/sync-echo";
import { syncLatestTaskValue } from "../../src/integrations/links/sync-latest-task-value";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import {
  githubWebhookSource,
  verifiedGitHubConfig,
} from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type IssueField = "title" | "description" | "state";

// The provider calls of the previous suite's mocked GitHub and Gitea clients.
const m = { read: vi.fn(), write: vi.fn() };
const double = createGitHubAppDouble();
let app: TestApp;
let deps: GitHubDeps;
let job: DeferredIssueEditsJob;
let publish: MockInstance<EventBus["publish"]>;
// Whether "gitea" replays through this suite's client double (the Gitea
// plugin had not registered its own deferred-edit access).
let giteaDouble = false;

beforeAll(async () => {
  app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  deps = app.get<GitHubDeps>(GITHUB_DEPS as never);
  job = app.get(DeferredIssueEditsJob);
  publish = vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
  const providers = app.get(DeferredIssueEditProviders);
  if (!providers.get("gitea")) {
    providers.register("gitea", async (_integration, link) => ({
      read: () => m.read(),
      write: async (field, value) =>
        (
          await m.write(
            field === "description"
              ? { body: formatIssueBody(value, link.taskId) }
              : { [field]: value },
          )
        )?.updated_at,
    }));
    giteaDouble = true;
  }
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  double.reset();
  double.octokit.rest.issues.get.mockImplementation(async () => ({
    data: await m.read(),
  }));
  double.octokit.rest.issues.update.mockImplementation(
    async (params: Record<string, unknown>) => ({ data: await m.write(params) }),
  );
  publish.mockClear();
  m.write.mockReset().mockResolvedValue({ updated_at: "2026-09-30T00:00:04Z" });
  m.read.mockReset().mockResolvedValue({
    title: "A",
    body: "recovered body",
    state: "closed",
    updated_at: "2026-09-30T00:00:03Z",
  });
});

/** Gitea replay cases need this suite's client double for "gitea". */
function requireGiteaDouble(provider: string, ctx: TestContext) {
  if (provider === "gitea" && !giteaDouble) ctx.skip();
}

const replay = () => job.replayDeferredIssueEdits();

async function seed(type = "github") {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const task = await createTask(app.db, {
    projectId: project.id,
    number: 1,
    title: "B",
    description: "old body",
    status: "to-do",
  });
  const binding = {
    baseUrl: "https://git.example",
    accessToken: "test-secret-never-metadata",
  };
  const integration = await insertRow(app.db, IntegrationEntity, {
    projectId: project.id,
    type,
    config: JSON.stringify(
      type === "github"
        ? verifiedGitHubConfig(binding)
        : {
            ...binding,
            repositoryOwner: "owner",
            repositoryName: "repo",
            installationId: 10,
            repositoryId: 20,
          },
    ),
  });
  const stamp = inboundStamp(
    outboundStamp(undefined, "A", undefined, {
      intentId: "dead-writer",
      pending: true,
    }),
    "B",
    type,
  );
  const link = await insertRow(app.db, ExternalLinkEntity, {
    taskId: task.id,
    integrationId: integration.id,
    resourceType: "issue",
    externalId: "1",
    url: "https://git.example/owner/repo/issues/1",
    metadata: JSON.stringify({ lastSync: { title: stamp } }),
  });
  return { project, task, integration, link };
}

async function metadata(linkId: string) {
  const link = await app.db.findOneBy(ExternalLinkEntity, { id: linkId });
  return JSON.parse(link?.metadata ?? "{}");
}

function current(taskId: string) {
  return app.db.findOneBy(TaskEntity, { id: taskId });
}

function setMetadata(linkId: string, value: unknown) {
  return app.db.update(
    ExternalLinkEntity,
    { id: linkId },
    { metadata: typeof value === "string" ? value : JSON.stringify(value) },
  );
}

function setTask(
  taskId: string,
  values: QueryDeepPartialEntity<TaskEntity>,
) {
  return app.db.update(TaskEntity, { id: taskId }, values);
}

function setIntegration(
  integrationId: string,
  values: QueryDeepPartialEntity<IntegrationEntity>,
) {
  return app.db.update(IntegrationEntity, { id: integrationId }, values);
}

/** The webhook's installation and repository (id 20, possibly renamed). */
function source(repositoryName = "repo") {
  return {
    installation: githubWebhookSource.installation,
    repository: {
      id: 20,
      name: repositoryName,
      full_name: `owner/${repositoryName}`,
      owner: { login: "owner" },
      html_url: `https://git.example/owner/${repositoryName}`,
    },
  };
}

async function deliverField(
  field: IssueField,
  value: string,
  version: string,
  repositoryName = "repo",
) {
  const payload = {
    ...source(repositoryName),
    action:
      field === "state"
        ? value === "closed"
          ? "closed"
          : "reopened"
        : "edited",
    issue: {
      number: 1,
      title: field === "title" ? value : "unchanged",
      body: field === "description" ? value : "unchanged",
      state: field === "state" ? value : "open",
      updated_at: version,
      html_url: `https://git.example/owner/${repositoryName}/issues/1`,
    },
    changes:
      field === "title"
        ? { title: { from: "before" } }
        : { body: { from: "before" } },
  };
  if (field !== "state") await handleIssueEdited(deps, payload);
  else
    await handleIssueStateChanged(
      deps,
      payload,
      value === "closed" ? "closed" : "open",
    );
}

const fields = ["title", "description", "state"] as const;
const providerFields = ["github", "gitea"].flatMap((provider) =>
  fields.map((field) => ({ provider, field })),
);
const githubFields = fields.map((field) => ({ provider: "github", field }));
const giteaFields = fields.map((field) => ({ provider: "gitea", field }));

it("durably acknowledges an orphaned delivery and later recovers every changed field", async () => {
  const { task, integration, link } = await seed();
  await handleIssueEdited(deps, {
    ...source(),
    action: "edited",
    issue: {
      number: 1,
      title: "A",
      body: "recovered body",
      html_url: link.url,
      updated_at: "2026-09-30T00:00:03Z",
    },
    changes: { title: { from: "B" }, body: { from: "old body" } },
  });
  const queued = await metadata(link.id);
  expect(queued.deferredIssueEdit.fields).toEqual(["title", "description"]);
  expect(JSON.stringify(queued)).not.toContain("test-secret-never-metadata");
  expect(JSON.stringify(queued)).not.toContain("recovered body");
  expect((await current(task.id))?.title).toBe("B");
  await replay();
  expect(m.read).not.toHaveBeenCalled();
  queued.lastSync.title.outbound[0].timestamp = new Date(
    Date.now() - 300_001,
  ).toISOString();
  await setMetadata(link.id, queued);
  await replay();
  expect(await current(task.id)).toMatchObject({
    title: "A",
    description: "recovered body",
  });
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  expect(publish).toHaveBeenCalledWith("task.updated", {
    taskId: task.id,
    projectId: integration.projectId,
  });
}, 15_000);

it.for(["github", "gitea"])(
  "recovers orphaned %s state through project workflows",
  async (type, ctx) => {
    requireGiteaDouble(type, ctx);
    const { task, integration, link } = await seed(type);
    await deferIssueEdit(app.db, link, integration, ["state"]);
    await replay();
    expect((await current(task.id))?.status).toBe("done");
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    expect(publish).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({
        taskId: task.id,
        oldStatus: "to-do",
        newStatus: "done",
      }),
    );
  },
);

it("retains failed provider reads and retries without sender redelivery", async () => {
  const { task, integration, link } = await seed();
  await deferIssueEdit(app.db, link, integration, ["description"]);
  m.read.mockRejectedValueOnce(new Error("provider unavailable"));
  expect(await replay()).toEqual({ degraded: true });
  expect((await metadata(link.id)).deferredIssueEdit.fields).toEqual([
    "description",
  ]);
  await replay();
  expect((await current(task.id))?.description).toBe("recovered body");
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

it("does not clear fields queued concurrently with a provider read", async () => {
  const { task, integration, link } = await seed();
  await deferIssueEdit(app.db, link, integration, ["state"]);
  m.read.mockImplementationOnce(async () => {
    await deferIssueEdit(app.db, link, integration, ["description"]);
    return { title: "A", body: "stale read", state: "closed" };
  });
  await replay();
  expect(await current(task.id)).toMatchObject({
    status: "to-do",
    description: "old body",
  });
  expect((await metadata(link.id)).deferredIssueEdit.fields).toEqual([
    "state",
    "description",
  ]);
  await replay();
  expect(await current(task.id)).toMatchObject({
    status: "done",
    description: "recovered body",
  });
});

it.each(["disabled", "rebound", "moved"])(
  "guards deferred edits when their integration is %s during HTTP",
  async (change) => {
    const { project, task, integration, link } = await seed();
    await deferIssueEdit(app.db, link, integration, ["description"]);
    m.read.mockImplementationOnce(async () => {
      if (change === "moved") {
        const other = await createProjectFixture(app.db, {
          workspaceId: project.workspaceId,
        });
        await setTask(task.id, { projectId: other.project.id });
      } else {
        await setIntegration(
          integration.id,
          change === "disabled"
            ? { isActive: false }
            : {
                config: JSON.stringify({
                  ...JSON.parse(integration.config),
                  repositoryName: "other",
                }),
              },
        );
      }
      return { title: "A", body: "wrong source", state: "closed" };
    });
    await replay();
    expect((await current(task.id))?.description).toBe("old body");
    expect(publish).not.toHaveBeenCalled();
    if (change !== "moved") {
      await replay();
      expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    }
  },
);

it("rechecks provider state after a newer inbound edit during HTTP", async () => {
  const { task, integration, link } = await seed();
  await deferIssueEdit(app.db, link, integration, ["description"]);
  m.read.mockImplementationOnce(async () => {
    await setTask(task.id, { description: "newer edit" });
    await updateExternalLink(app.db, link.id, {
      metadata: {
        lastSync: {
          description: inboundStamp(undefined, "newer edit", "github"),
        },
      },
    });
    return { title: "A", body: "stale read", state: "closed" };
  });
  await replay();
  expect((await current(task.id))?.description).toBe("newer edit");
  expect((await metadata(link.id)).deferredIssueEdit).toBeDefined();
  m.read.mockResolvedValueOnce({
    title: "A",
    body: "newer edit",
    state: "closed",
  });
  await replay();
  expect((await current(task.id))?.description).toBe("newer edit");
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

it("retains deferred edits across credential rotation on the same repository", async (ctx) => {
  requireGiteaDouble("gitea", ctx);
  const { task, integration, link } = await seed("gitea");
  await setIntegration(integration.id, {
    config: JSON.stringify({
      ...JSON.parse(integration.config),
      accessToken: "rotated-test-secret",
    }),
  });
  await deferIssueEdit(app.db, link, integration, ["description"]);
  expect((await metadata(link.id)).deferredIssueEdit.fields).toEqual([
    "description",
  ]);
  await replay();
  expect((await current(task.id))?.description).toBe("recovered body");
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

it("does not overwrite a local edit committed before its integration subscriber stamps it", async () => {
  const { task, integration, link } = await seed();
  await deferIssueEdit(app.db, link, integration, ["description"]);
  m.read.mockImplementationOnce(async () => {
    await setTask(task.id, { description: "new local edit" });
    return { title: "A", body: "stale provider body", state: "closed" };
  });
  await replay();
  expect((await current(task.id))?.description).toBe("new local edit");
  expect((await metadata(link.id)).deferredIssueEdit).toBeDefined();
  expect(publish).not.toHaveBeenCalled();
});

it.for(providerFields)(
  "repairs an expired older $provider $field writer without importing its stale value",
  async ({ provider, field }, ctx) => {
    requireGiteaDouble(provider, ctx);
    const { task, integration, link } = await seed(provider);
    const local =
      field === "title" ? "B" : field === "description" ? "old body" : "open";
    const stale =
      field === "title"
        ? "A"
        : field === "description"
          ? "recovered body"
          : "closed";
    const stamp = outboundStamp(
      outboundStamp(undefined, stale, undefined, {
        intentId: "orphan",
        pending: true,
      }),
      local,
      "2026-09-30T00:00:02Z",
      { intentId: "newer-completed", pending: false },
    );
    const orphan = stamp.outbound?.find((entry) => entry.intentId === "orphan");
    if (!orphan) throw new Error("Missing orphan fixture");
    orphan.timestamp = new Date(Date.now() - 300_001).toISOString();
    await setMetadata(link.id, { lastSync: { [field]: stamp } });
    await deferIssueEdit(app.db, link, integration, [field]);
    expect(
      (await metadata(link.id)).lastSync[field].outbound.find(
        (entry: { intentId: string }) => entry.intentId === "orphan",
      ),
    ).toMatchObject({ pending: false, uncertain: true });
    await replay();
    expect(await current(task.id)).toMatchObject({
      title: "B",
      description: "old body",
      status: "to-do",
    });
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining(
        field === "description"
          ? { body: expect.stringContaining("old body") }
          : { [field]: local },
      ),
    );
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  },
);

it("repairs an orphaned write using a newer local value whose subscriber has not stamped it", async () => {
  const { task, integration, link } = await seed();
  const stamp = outboundStamp(
    outboundStamp(undefined, "A", undefined, {
      intentId: "orphan",
      pending: true,
    }),
    "B",
    "2026-09-30T00:00:02Z",
    { intentId: "completed" },
  );
  const orphan = stamp.outbound?.find((entry) => entry.intentId === "orphan");
  if (!orphan) throw new Error("Missing orphan fixture");
  orphan.timestamp = new Date(Date.now() - 300_001).toISOString();
  await setMetadata(link.id, { lastSync: { title: stamp } });
  await setTask(task.id, { title: "C" });
  await deferIssueEdit(app.db, link, integration, ["title"]);
  await replay();
  expect((await current(task.id))?.title).toBe("C");
  expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ title: "C" }));
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

it("preserves the final github value when colliding-version webhooks arrive in reverse", async () => {
  const { task, link } = await seed();
  await setTask(task.id, { title: "A" });
  await setMetadata(link.id, {
    lastSync: {
      title: outboundStamp(undefined, "A", "2026-09-30T00:00:03Z"),
    },
  });
  const apply = (title: string, from: string) =>
    handleIssueEdited(deps, {
      ...source(),
      action: "edited",
      issue: {
        number: 1,
        title,
        body: "body",
        updated_at: "2026-09-30T00:00:03Z",
        html_url: link.url,
      },
      changes: { title: { from } },
    });
  await apply("A", "B");
  await apply("B", "A");
  expect((await current(task.id))?.title).toBe("A");
  expect(m.read).toHaveBeenCalledOnce();
  m.read.mockResolvedValueOnce({
    title: "B",
    body: "body",
    state: "open",
    updated_at: "2026-09-30T00:00:03Z",
  });
  await apply("B", "A");
  expect((await current(task.id))?.title).toBe("B");
});
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it.each([false, true])(
  "repairs a crashed first write after a later local edit (previousInbound=%s)",
  async (previousInbound) => {
    const { task, integration, link } = await seed();
    const prior = previousInbound
      ? inboundStamp(undefined, "B", "github")
      : undefined;
    const stamp = outboundStamp(prior, "A", undefined, {
      intentId: "first-orphan",
      pending: true,
    });
    const orphan = stamp.outbound?.find(
      (entry) => entry.intentId === "first-orphan",
    );
    if (!orphan) throw new Error("Missing orphan fixture");
    orphan.timestamp = new Date(Date.now() - 300_001).toISOString();
    await setMetadata(link.id, { lastSync: { title: stamp } });
    await setTask(task.id, { title: "B" });
    await deferIssueEdit(app.db, link, integration, ["title"]);
    await replay();
    expect((await current(task.id))?.title).toBe("B");
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining({ title: "B" }),
    );
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  },
);

it("protects a local ABA edit even when its final fields and timestamp are unchanged", async () => {
  const { task, integration, link } = await seed();
  const updatedAt = new Date("2026-09-30T00:00:00Z");
  const setDescription = (
    db: { query: TestApp["db"]["query"] },
    description: string,
  ) =>
    db.query(
      `UPDATE task SET description = $1, updated_at = $2 WHERE id = $3`,
      [description, updatedAt, task.id],
    );
  await app.db.query(`UPDATE task SET updated_at = $1 WHERE id = $2`, [
    updatedAt,
    task.id,
  ]);
  await deferIssueEdit(app.db, link, integration, ["description"]);
  m.read.mockImplementationOnce(async () => {
    await app.db.transaction(async (tx) => {
      await setDescription(tx, "temporary edit");
      await setDescription(tx, "old body");
    });
    return { title: "A", body: "stale provider body", state: "closed" };
  });
  await replay();
  expect((await current(task.id))?.description).toBe("old body");
  expect((await metadata(link.id)).deferredIssueEdit).toBeDefined();
});

it.for(["github", "gitea"])(
  "retires a deleted %s issue's deferred read without removing its link or task",
  async (provider, ctx) => {
    requireGiteaDouble(provider, ctx);
    const { task, integration, link } = await seed(provider);
    await deferIssueEdit(app.db, link, integration, ["description"]);
    m.read.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    expect(await replay()).toEqual({ degraded: false });
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    expect(await current(task.id)).toMatchObject({
      title: "B",
      description: "old body",
    });
    expect(
      await app.db.findOneBy(ExternalLinkEntity, { id: link.id }),
    ).not.toBeNull();
    expect(publish).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
    await replay();
    expect(m.read).toHaveBeenCalledOnce();
  },
);

it.each([403, 429, 500, 408])(
  "retains a deferred issue read after HTTP %s",
  async (status) => {
    const { integration, link } = await seed();
    await deferIssueEdit(app.db, link, integration, ["description"]);
    m.read.mockRejectedValue(
      Object.assign(new Error("provider unavailable"), { status }),
    );
    expect(await replay()).toEqual({ degraded: true });
    expect((await metadata(link.id)).deferredIssueEdit.fields).toEqual([
      "description",
    ]);
  },
);

it("preserves a newer job queued while a missing-issue read is in flight", async () => {
  const { task, integration, link } = await seed();
  await deferIssueEdit(app.db, link, integration, ["state"]);
  m.read.mockImplementationOnce(async () => {
    await deferIssueEdit(app.db, link, integration, ["description"]);
    throw Object.assign(new Error("not found"), { status: 404 });
  });
  await replay();
  expect((await metadata(link.id)).deferredIssueEdit.fields).toEqual([
    "state",
    "description",
  ]);
  await replay();
  expect(await current(task.id)).toMatchObject({
    status: "done",
    description: "recovered body",
  });
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

it("retains missing-issue work when credentials rotate during the read", async (ctx) => {
  requireGiteaDouble("gitea", ctx);
  const { task, integration, link } = await seed("gitea");
  await deferIssueEdit(app.db, link, integration, ["description"]);
  m.read.mockImplementationOnce(async () => {
    await setIntegration(integration.id, {
      config: JSON.stringify({
        ...JSON.parse(integration.config),
        accessToken: "rotated-test-secret",
      }),
    });
    throw Object.assign(new Error("not found"), { status: 404 });
  });
  await replay();
  expect((await metadata(link.id)).deferredIssueEdit).toBeDefined();
  await replay();
  expect((await current(task.id))?.description).toBe("recovered body");
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

const collisionCases = (entries: { provider: string; field: IssueField }[]) =>
  entries.flatMap((entry) =>
    [false, true].map((collision) => ({ ...entry, collision })),
  );
it.each(collisionCases(githubFields))(
  "preserves the latest genuine $provider $field delivery (sameVersion=$collision)",
  async ({ field, collision }) => {
    const { task, link } = await seed();
    await setMetadata(link.id, "{}");
    const latest = field === "state" ? "open" : "remote-new";
    const older = field === "state" ? "closed" : "remote-old";
    const version = "2026-09-30T00:00:03Z";
    m.read.mockResolvedValue({
      title: latest,
      body: latest,
      state: "open",
      updated_at: version,
    });
    await deliverField(field, latest, version);
    await deliverField(
      field,
      older,
      collision ? version : "2026-09-30T00:00:02Z",
    );
    const row = await current(task.id);
    expect(field === "state" ? row?.status : row?.[field]).toBe(
      field === "state" ? "to-do" : latest,
    );
    expect((await metadata(link.id)).lastSync[field].inboundUpdatedAt).toBe(
      version,
    );
    if (collision) expect(m.read).toHaveBeenCalledOnce();
    else expect(m.read).not.toHaveBeenCalled();
    await deliverField(field, older, "2026-09-30T00:00:04Z");
    const after = await current(task.id);
    expect(field === "state" ? after?.status : after?.[field]).toBe(
      field === "state" ? "done" : older,
    );
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

const uncertainCountCases = (
  entries: { provider: string; field: IssueField }[],
) => entries.flatMap((entry) => [1, 2].map((count) => ({ ...entry, count })));
it.each(uncertainCountCases(githubFields))(
  "repairs a late timed-out $provider $field write without reverting the newer local value (uncertain=$count)",
  async ({ field, count }) => {
    const { task, link } = await seed();
    const older = field === "state" ? "closed" : "remote-old";
    const latest =
      field === "state" ? "open" : field === "title" ? "B" : "old body";
    const pending = outboundStamp(undefined, older, undefined, {
      intentId: "timed-out",
      pending: true,
    });
    let uncertain = outboundStamp(pending, older, undefined, {
      intentId: "timed-out",
      pending: false,
      uncertain: true,
    });
    if (count === 2)
      uncertain = outboundStamp(uncertain, older, undefined, {
        intentId: "second-timed-out",
        pending: false,
        uncertain: true,
      });
    const stamp = outboundStamp(uncertain, latest, "2026-09-30T00:00:02Z", {
      intentId: "newer-completed",
    });
    await setMetadata(link.id, { lastSync: { [field]: stamp } });
    m.read.mockResolvedValue({
      title: older,
      body: older,
      state: "closed",
      updated_at: "2026-09-30T00:00:03Z",
    });
    await deliverField(field, older, "2026-09-30T00:00:03Z");
    expect((await metadata(link.id)).deferredIssueEdit.fields).toEqual([field]);
    expect(await current(task.id)).toMatchObject({
      title: "B",
      description: "old body",
      status: "to-do",
    });
    await replay();
    expect(await current(task.id)).toMatchObject({
      title: "B",
      description: "old body",
      status: "to-do",
    });
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining(
        field === "description"
          ? { body: expect.stringContaining(latest) }
          : { [field]: latest },
      ),
    );
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
    await deliverField(field, older, "2026-09-30T00:00:05Z");
    const later = await current(task.id);
    expect(field === "state" ? later?.status : later?.[field]).toBe(
      field === "state" ? "done" : older,
    );
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it("completes uncertain replay when the task already equals the provider", async () => {
  const { task, integration, link } = await seed();
  const uncertain = outboundStamp(
    outboundStamp(undefined, "A", undefined, {
      intentId: "uncertain",
      pending: true,
    }),
    "A",
    undefined,
    { intentId: "uncertain", pending: false, uncertain: true },
  );
  const stamp = outboundStamp(uncertain, "B", "2026-09-30T00:00:02Z");
  await setMetadata(link.id, { lastSync: { title: stamp } });
  await setTask(task.id, { title: "A" });
  await deferIssueEdit(app.db, link, integration, ["title"]);
  expect(await replay()).toEqual({ degraded: false });
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  expect((await current(task.id))?.title).toBe("A");
  expect(m.write).not.toHaveBeenCalled();
});

it("repairs an uncertain delivery over an unstamped local edit after a genuine provider edit", async () => {
  const { task, link } = await seed();
  const pending = outboundStamp(undefined, "A", undefined, {
    intentId: "uncertain",
    pending: true,
  });
  const stamp = inboundStamp(
    outboundStamp(pending, "A", undefined, {
      intentId: "uncertain",
      pending: false,
      uncertain: true,
    }),
    "B",
    "github",
    "2026-09-30T00:00:02Z",
  );
  await setMetadata(link.id, { lastSync: { title: stamp } });
  await setTask(task.id, { title: "C" });
  await deliverField("title", "A", "2026-09-30T00:00:03Z");
  expect((await current(task.id))?.title).toBe("C");
  expect((await metadata(link.id)).deferredIssueEdit.fields).toEqual(["title"]);
  await replay();
  expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ title: "C" }));
});

it("retains the uncertain intent and job when corrective provider HTTP fails", async () => {
  const { task, integration, link } = await seed();
  const pending = outboundStamp(undefined, "A", undefined, {
    intentId: "failed-repair",
    pending: true,
  });
  const stamp = outboundStamp(
    outboundStamp(pending, "A", undefined, {
      intentId: "failed-repair",
      pending: false,
      uncertain: true,
    }),
    "B",
    "2026-09-30T00:00:02Z",
  );
  await setMetadata(link.id, { lastSync: { title: stamp } });
  await deferIssueEdit(app.db, link, integration, ["title"]);
  m.write.mockRejectedValueOnce(new Error("provider unavailable"));
  expect(await replay()).toEqual({ degraded: true });
  const queued = await metadata(link.id);
  expect(queued.deferredIssueEdit).toBeDefined();
  const retained = queued.lastSync.title.outbound.find(
    (entry: { intentId: string }) => entry.intentId === "failed-repair",
  );
  expect(retained.uncertain).toBe(true);
  expect(retained.cancelled).not.toBe(true);
  await replay();
  expect((await current(task.id))?.title).toBe("B");
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

it.each(githubFields)(
  "rechecks a stale $provider $field confirmation after a newer colliding webhook",
  async ({ provider, field }) => {
    const { task, link } = await seed(provider);
    const version = "2026-09-30T00:00:03Z";
    const initial = field === "state" ? "closed" : "A";
    const stale = field === "state" ? "open" : "B";
    const latest = field === "state" ? "closed" : "C";
    await setTask(task.id, {
      [field === "state" ? "status" : field]:
        field === "state" ? "done" : initial,
    });
    await setMetadata(link.id, {
      lastSync: {
        [field]: inboundStamp(undefined, initial, provider, version),
      },
    });
    m.read.mockResolvedValue({
      title: latest,
      body: latest,
      state: "closed",
      updated_at: version,
    });
    m.read.mockImplementationOnce(async () => {
      await deliverField(field, latest, version);
      return { title: stale, body: stale, state: "open", updated_at: version };
    });
    await deliverField(field, stale, version);
    const row = await current(task.id);
    expect(field === "state" ? row?.status : row?.[field]).toBe(
      field === "state" ? "done" : latest,
    );
    expect((await metadata(link.id)).lastSync[field].inboundValue).toBe(latest);
    expect(m.read.mock.calls.length).toBeGreaterThanOrEqual(2);
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it("validates each changed github field when a shared confirmation GET becomes stale", async () => {
  const { task, link } = await seed();
  const version = "2026-09-30T00:00:03Z";
  await setTask(task.id, { title: "A", description: "A" });
  await setMetadata(link.id, {
    lastSync: {
      title: inboundStamp(undefined, "A", "github", version),
      description: inboundStamp(undefined, "A", "github", version),
    },
  });
  m.read.mockResolvedValue({
    title: "B",
    body: "C",
    state: "open",
    updated_at: version,
  });
  m.read.mockImplementationOnce(async () => {
    await deliverField("description", "C", version);
    return { title: "B", body: "B", state: "open", updated_at: version };
  });
  await handleIssueEdited(deps, {
    ...source(),
    action: "edited",
    issue: {
      number: 1,
      title: "B",
      body: "B",
      updated_at: version,
      html_url: link.url,
    },
    changes: { title: { from: "A" }, body: { from: "A" } },
  });
  expect(await current(task.id)).toMatchObject({
    title: "B",
    description: "C",
  });
});
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it("preserves a newer local edit committed during github provider confirmation", async () => {
  const { task, link } = await seed();
  const version = "2026-09-30T00:00:03Z";
  await setTask(task.id, { title: "A" });
  await setMetadata(link.id, {
    lastSync: { title: inboundStamp(undefined, "A", "github", version) },
  });
  m.read.mockResolvedValue({
    title: "B",
    body: "body",
    state: "open",
    updated_at: version,
  });
  m.read.mockImplementationOnce(async () => {
    await setTask(task.id, { title: "C" });
    return { title: "B", body: "body", state: "open", updated_at: version };
  });
  await deliverField("title", "B", version);
  expect((await current(task.id))?.title).toBe("C");
  expect(publish).not.toHaveBeenCalled();
});
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it.for(providerFields)(
  "bounds sustained $provider/$field correction and durably syncs the latest task",
  async ({ provider, field }, ctx) => {
    requireGiteaDouble(provider, ctx);
    const { task, integration, link } = await seed(provider);
    await setMetadata(link.id, "{}");
    const initial = field === "state" ? "open" : "A";
    const column = field === "state" ? "status" : field;
    const write = vi.fn(async (_value: string) => {
      if (write.mock.calls.length > 6)
        throw new Error("unbounded repair regression");
      await setTask(task.id, {
        [column]:
          field === "state"
            ? write.mock.calls.length % 2
              ? "done"
              : "to-do"
            : `edit-${write.mock.calls.length}`,
      });
      return "2026-09-30T00:00:04Z";
    });
    await syncLatestTaskValue(
      app.db,
      app.get(EventBus),
      task.id,
      integration.projectId,
      link,
      field,
      initial,
      write,
    ).catch(() => undefined);
    expect(write).toHaveBeenCalledTimes(3);
    expect((await metadata(link.id)).deferredIssueEdit).toMatchObject({
      fields: [],
      repairFields: [field],
    });
    expect(JSON.stringify(await metadata(link.id))).not.toContain(
      "test-secret-never-metadata",
    );
    const latest = field === "state" ? "closed" : "latest local";
    await setTask(task.id, { [column]: field === "state" ? "done" : latest });
    await replay();
    expect(m.write).toHaveBeenCalledTimes(1);
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining(
        field === "description"
          ? { body: expect.stringContaining(latest) }
          : { [field]: latest },
      ),
    );
    expect((await current(task.id))?.[column]).toBe(
      field === "state" ? "done" : latest,
    );
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  },
);

it("coalesces local correction fields with inbound deliveries without importing stale values", async () => {
  const { task, integration, link } = await seed();
  await setMetadata(link.id, "{}");
  await Promise.all([
    deferTaskSync(app.db, link, integration, ["title"]),
    deferTaskSync(app.db, link, integration, ["description"]),
    deferIssueEdit(app.db, link, integration, ["state"]),
  ]);
  const queued = (await metadata(link.id)).deferredIssueEdit;
  expect(queued.fields).toEqual(["state"]);
  expect(queued.repairFields.sort()).toEqual(["description", "title"]);
  await replay();
  expect(await current(task.id)).toMatchObject({
    title: "B",
    description: "old body",
    status: "done",
  });
  expect(m.write).toHaveBeenCalledTimes(2);
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

it("retains failed queued corrections and retries the current task value", async () => {
  const { task, integration, link } = await seed();
  await setMetadata(link.id, "{}");
  await deferTaskSync(app.db, link, integration, ["title"]);
  m.write.mockRejectedValueOnce(new Error("provider unavailable"));
  expect(await replay()).toEqual({ degraded: true });
  expect((await metadata(link.id)).deferredIssueEdit.repairFields).toEqual([
    "title",
  ]);
  await setTask(task.id, { title: "latest" });
  await replay();
  expect(m.write).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "latest" }),
  );
  expect((await current(task.id))?.title).toBe("latest");
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  expect(publish).not.toHaveBeenCalled();
});

it("preserves a newer correction queued while its worker reads the provider", async () => {
  const { integration, link } = await seed();
  await setMetadata(link.id, "{}");
  await deferTaskSync(app.db, link, integration, ["title"]);
  const first = (await metadata(link.id)).deferredIssueEdit.id;
  m.read.mockImplementationOnce(async () => {
    await deferTaskSync(app.db, link, integration, ["description"]);
    return { title: "A", body: "remote", state: "open" };
  });
  await replay();
  expect(m.write).not.toHaveBeenCalled();
  const next = (await metadata(link.id)).deferredIssueEdit;
  expect(next.id).not.toBe(first);
  expect(next.repairFields.sort()).toEqual(["description", "title"]);
  await replay();
  expect(m.write).toHaveBeenCalledTimes(2);
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
});

it.each([1, 2])(
  "retires uncertain intents after queued github correction so future genuine edits apply (uncertain=%s)",
  async (count) => {
    const { task, integration, link } = await seed();
    let stamp = outboundStamp(undefined, "A", undefined, {
      intentId: "old-unknown",
      pending: false,
      uncertain: true,
    });
    if (count === 2)
      stamp = outboundStamp(stamp, "A", undefined, {
        intentId: "second-unknown",
        pending: false,
        uncertain: true,
      });
    await setMetadata(link.id, { lastSync: { title: stamp } });
    await deferTaskSync(app.db, link, integration, ["title"]);
    await replay();
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining({ title: "B" }),
    );
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    m.read.mockResolvedValue({
      title: "A",
      body: "remote",
      state: "open",
      updated_at: "2026-09-30T00:00:05Z",
    });
    await deliverField("title", "A", "2026-09-30T00:00:05Z");
    expect((await current(task.id))?.title).toBe("A");
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it.for([
  { provider: "github", mode: "webhook" },
  { provider: "github", mode: "worker" },
  { provider: "gitea", mode: "worker" },
])(
  "protects a local edit when only the older of two uncertain $provider writes precedes it ($mode)",
  async ({ provider, mode }, ctx) => {
    requireGiteaDouble(provider, ctx);
    const { task, integration, link } = await seed(provider);
    let stamp = outboundStamp(undefined, "A", undefined, {
      intentId: "before-local",
      pending: true,
    });
    stamp = inboundStamp(stamp, "B", provider);
    stamp = outboundStamp(stamp, "A", undefined, {
      intentId: "after-local",
      pending: true,
    });
    stamp = outboundStamp(stamp, "A", undefined, {
      intentId: "before-local",
      pending: false,
      uncertain: true,
    });
    stamp = outboundStamp(stamp, "A", undefined, {
      intentId: "after-local",
      pending: false,
      uncertain: true,
    });
    await setMetadata(link.id, { lastSync: { title: stamp } });
    if (mode === "webhook")
      await deliverField("title", "A", "2026-09-30T00:00:03Z");
    else await deferIssueEdit(app.db, link, integration, ["title"]);
    await replay();
    expect((await current(task.id))?.title).toBe("B");
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining({ title: "B" }),
    );
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it.each(["uncertain", "pending"])(
  "settles a matching %s write during repair while preserving active requests",
  async (kind) => {
    const { integration, link } = await seed();
    await setMetadata(link.id, {
      lastSync: {
        title: outboundStamp(undefined, "A", undefined, {
          intentId: "old",
          uncertain: true,
        }),
      },
    });
    await deferTaskSync(app.db, link, integration, ["title"]);
    m.write.mockImplementationOnce(async () => {
      await updateExternalLink(app.db, link.id, {
        outbound: {
          field: "title",
          value: "A",
          intentId: "new",
          pending: kind === "pending",
          uncertain: kind === "uncertain",
        },
      });
      return { updated_at: "2026-09-30T00:00:04Z" };
    });
    await replay();
    const entries = (await metadata(link.id)).lastSync.title.outbound;
    expect(
      entries.find((entry: { intentId: string }) => entry.intentId === "old"),
    ).toMatchObject({ cancelled: true, uncertain: false, pending: false });
    expect(
      entries.find((entry: { intentId: string }) => entry.intentId === "new"),
    ).toMatchObject({
      pending: kind === "pending",
      uncertain: false,
    });
    expect(
      entries.find((entry: { intentId: string }) => entry.intentId === "new")
        .cancelled,
    ).toBe(kind === "uncertain" ? true : undefined);
  },
);

it("retains every captured uncertain intent when the corrective provider write fails", async () => {
  const { integration, link } = await seed();
  let stamp = outboundStamp(undefined, "A", undefined, {
    intentId: "first",
    uncertain: true,
  });
  stamp = outboundStamp(stamp, "A", undefined, {
    intentId: "second",
    uncertain: true,
  });
  await setMetadata(link.id, { lastSync: { title: stamp } });
  await deferTaskSync(app.db, link, integration, ["title"]);
  m.write.mockRejectedValueOnce(new Error("provider unavailable"));
  expect(await replay()).toEqual({ degraded: true });
  const saved = await metadata(link.id);
  expect(saved.deferredIssueEdit).toBeDefined();
  for (const id of ["first", "second"]) {
    const intent = saved.lastSync.title.outbound.find(
      (entry: { intentId: string }) => entry.intentId === id,
    );
    expect(intent.uncertain).toBe(true);
    expect(intent.cancelled).not.toBe(true);
  }
});

const changeCases = (entries: { provider: string; field: IssueField }[]) =>
  entries.flatMap((entry) =>
    ["rebound", "disabled", "credentials"].map((change) => ({
      ...entry,
      change,
    })),
  );
it.each(changeCases(githubFields))(
  "guards the $provider $field confirmation after its integration is $change",
  async ({ provider, field, change }) => {
    const { task, integration, link } = await seed(provider);
    const version = "2026-09-30T00:00:03Z";
    const before = field === "state" ? "closed" : "A";
    const after = field === "state" ? "open" : "B";
    const column = field === "state" ? "status" : field;
    await setTask(task.id, { [column]: field === "state" ? "done" : before });
    await setMetadata(link.id, {
      lastSync: {
        [field]: inboundStamp(undefined, before, provider, version),
      },
    });
    m.read.mockImplementationOnce(async () => {
      const config = JSON.parse(integration.config);
      await setIntegration(
        integration.id,
        change === "disabled"
          ? { isActive: false }
          : {
              config: JSON.stringify({
                ...config,
                ...(change === "rebound"
                  ? { repositoryName: "other" }
                  : { accessToken: "new-fake-token" }),
              }),
            },
      );
      return {
        title: field === "title" ? after : "A",
        body: field === "description" ? after : "A",
        state: field === "state" ? after : "closed",
        updated_at: version,
      };
    });
    await deliverField(field, after, version);
    const value = change === "credentials" ? after : before;
    expect((await current(task.id))?.[column]).toBe(
      field === "state" ? (value === "closed" ? "done" : "to-do") : value,
    );
    expect(m.read).toHaveBeenCalledOnce();
    if (change !== "credentials") expect(publish).not.toHaveBeenCalled();
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

const modeCases = (entries: { provider: string; field: IssueField }[]) =>
  entries.flatMap((entry) =>
    ["inbound", "queued"].map((mode) => ({ ...entry, mode })),
  );
it.each(modeCases(githubFields))(
  "retires successful $provider/$field repairs before a later field fails ($mode)",
  async ({ provider, field, mode }) => {
    const { task, integration, link } = await seed(provider);
    const next = field === "title" ? "description" : "title";
    const before = field === "state" ? "closed" : "A";
    const stamps: Record<string, unknown> = {};
    for (const f of [field, next]) {
      const value = f === "state" ? "closed" : "A";
      stamps[f] = outboundStamp(
        outboundStamp(undefined, value, undefined, {
          intentId: `${f}-old-1`,
          uncertain: true,
        }),
        value,
        undefined,
        { intentId: `${f}-old-2`, uncertain: true },
      );
    }
    await setMetadata(link.id, { lastSync: stamps });
    if (mode === "queued")
      await deferTaskSync(app.db, link, integration, [field, next]);
    else await deferIssueEdit(app.db, link, integration, [field, next]);
    const issue: {
      title: string;
      body: string;
      state: string;
      updated_at: string;
    } = {
      title: "A",
      body: "A",
      state: "closed",
      updated_at: "2026-09-30T00:00:03Z",
    };
    m.read.mockImplementation(async () => ({ ...issue }));
    m.write.mockImplementation(async (payload: Record<string, string>) => {
      if (m.write.mock.calls.length === 2)
        throw new Error("second field failed");
      if (payload.title !== undefined) issue.title = payload.title;
      if (payload.body !== undefined) issue.body = payload.body;
      if (payload.state !== undefined) issue.state = payload.state;
      issue.updated_at = "2026-09-30T00:00:05Z";
      return { updated_at: issue.updated_at };
    });
    expect(await replay()).toEqual({ degraded: true });
    const saved = await metadata(link.id);
    expect(saved.deferredIssueEdit).toBeDefined();
    for (const id of [`${field}-old-1`, `${field}-old-2`])
      expect(
        saved.lastSync[field].outbound.find(
          (entry: { intentId: string }) => entry.intentId === id,
        ),
      ).toMatchObject({ cancelled: true, uncertain: false });
    for (const id of [`${next}-old-1`, `${next}-old-2`])
      expect(
        saved.lastSync[next].outbound.find(
          (entry: { intentId: string }) => entry.intentId === id,
        ).cancelled,
      ).not.toBe(true);
    await replay();
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    if (field === "description") issue.body = before;
    else issue[field] = before;
    issue.updated_at = "2026-09-30T00:00:06Z";
    await deliverField(field, before, issue.updated_at);
    expect(
      field === "state"
        ? (await current(task.id))?.status
        : (await current(task.id))?.[field],
    ).toBe(field === "state" ? "done" : before);
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it.each(githubFields)(
  "settles a $provider/$field write that becomes uncertain during correction before later genuine edits",
  async ({ provider, field }) => {
    const { task, integration, link } = await seed(provider);
    const older = field === "state" ? "closed" : "A";
    await setMetadata(link.id, {
      lastSync: {
        [field]: outboundStamp(undefined, older, undefined, {
          intentId: "old",
          uncertain: true,
        }),
      },
    });
    await deferTaskSync(app.db, link, integration, [field]);
    m.write.mockImplementationOnce(async () => {
      await updateExternalLink(app.db, link.id, {
        outbound: {
          field,
          value: older,
          intentId: "during-repair",
          pending: false,
          uncertain: true,
        },
      });
      return { updated_at: "2026-09-30T00:00:04Z" };
    });
    await replay();
    const column = field === "state" ? "status" : field;
    const later = field === "state" ? "open" : "C";
    await setTask(task.id, {
      [column]: field === "state" ? "in-progress" : later,
    });
    await syncLatestTaskValue(
      app.db,
      app.get(EventBus),
      task.id,
      integration.projectId,
      link,
      field,
      later,
      async () => "2026-09-30T00:00:05Z",
    );
    m.read.mockResolvedValue({
      title: older,
      body: older,
      state: "closed",
      updated_at: "2026-09-30T00:00:06Z",
    });
    await deliverField(field, older, "2026-09-30T00:00:06Z");
    expect((await current(task.id))?.[column]).toBe(
      field === "state" ? "done" : older,
    );
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it("queues an intent inserted after the repair receipt for a fresh correction", async () => {
  const { task, integration, link } = await seed();
  await setMetadata(link.id, {
    lastSync: {
      title: outboundStamp(undefined, "A", undefined, {
        intentId: "old",
        uncertain: true,
      }),
    },
  });
  await deferTaskSync(app.db, link, integration, ["title"]);
  // The previous suite intercepted the link reads of the outbound writer
  // (`findExternalLinksByTask`), which run through a query builder here.
  const getMany = SelectQueryBuilder.prototype.getMany;
  let inserted = false;
  const spy = vi
    .spyOn(SelectQueryBuilder.prototype, "getMany")
    .mockImplementation(async function (this: SelectQueryBuilder<object>) {
      const rows = await getMany.call(this);
      if (
        !inserted &&
        m.write.mock.calls.length &&
        rows.some(
          (row) =>
            row instanceof ExternalLinkEntity &&
            JSON.parse(row.metadata ?? "{}").lastSync?.title?.value === "B",
        )
      ) {
        inserted = true;
        await updateExternalLink(app.db, link.id, {
          outbound: {
            field: "title",
            value: "A",
            intentId: "after-receipt",
            pending: false,
            uncertain: true,
          },
        });
        return getMany.call(this);
      }
      return rows;
    });
  try {
    await replay();
  } finally {
    spy.mockRestore();
  }
  expect(inserted).toBe(true);
  expect((await metadata(link.id)).deferredIssueEdit.repairFields).toEqual([
    "title",
  ]);
  await setTask(task.id, { title: "C" });
  await syncLatestTaskValue(
    app.db,
    app.get(EventBus),
    task.id,
    integration.projectId,
    link,
    "title",
    "C",
    async () => "2026-09-30T00:00:05Z",
  );
  m.read.mockResolvedValue({
    title: "A",
    body: "body",
    state: "open",
    updated_at: "2026-09-30T00:00:06Z",
  });
  await deliverField("title", "A", "2026-09-30T00:00:06Z");
  expect((await current(task.id))?.title).toBe("A");
});

it("durably queues an uncertain standalone writer and later settles it", async () => {
  const { task, integration, link } = await seed();
  await setMetadata(link.id, "{}");
  await expect(
    syncLatestTaskValue(
      app.db,
      app.get(EventBus),
      task.id,
      integration.projectId,
      link,
      "title",
      "A",
      async () => {
        throw new Error("provider unavailable");
      },
    ),
  ).rejects.toThrow("provider unavailable");
  expect((await metadata(link.id)).deferredIssueEdit.repairFields).toEqual([
    "title",
  ]);
  await replay();
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  m.read.mockResolvedValue({
    title: "A",
    body: "body",
    state: "open",
    updated_at: "2026-09-30T00:00:06Z",
  });
  await deliverField("title", "A", "2026-09-30T00:00:06Z");
  expect((await current(task.id))?.title).toBe("A");
});

it("skips provider reads and writes while another replica holds the worker lease", async () => {
  const { link, integration } = await seed();
  await deferTaskSync(app.db, link, integration, ["title"]);
  await app.db.query(`INSERT INTO job_lease (name, owner, expires_at)
    VALUES ('deferred-issue-edits', 'other-replica', now() + interval '10 minutes')`);
  expect(await replay()).toEqual({});
  expect(m.read).not.toHaveBeenCalled();
  expect(m.write).not.toHaveBeenCalled();
  expect((await metadata(link.id)).deferredIssueEdit).toBeDefined();
});

it("recovers a crashed replica lease and releases it after processing", async () => {
  const { link, integration } = await seed();
  await updateExternalLink(app.db, link.id, {
    outbound: {
      field: "title",
      value: "A",
      intentId: "dead-writer",
      cancelled: true,
    },
  });
  await updateExternalLink(app.db, link.id, {
    outbound: { field: "title", value: "B" },
  });
  await deferTaskSync(app.db, link, integration, ["title"]);
  await app.db.query(`INSERT INTO job_lease (name, owner, expires_at)
    VALUES ('deferred-issue-edits', 'crashed-replica', now() - interval '1 minute')`);
  await replay();
  expect(m.read).toHaveBeenCalledTimes(1);
  expect(m.write).toHaveBeenCalledTimes(1);
  expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  expect(
    await app.db.query(
      `SELECT name FROM job_lease WHERE name = 'deferred-issue-edits'`,
    ),
  ).toEqual([]);
});

it("uses the queued-link partial index without inspecting historical issue metadata", async () => {
  const { link, integration } = await seed();
  await deferTaskSync(app.db, link, integration, ["title"]);
  await app.db.transaction(async (tx) => {
    await tx.query(`SET LOCAL enable_seqscan = off`);
    const plan = (await tx.query(`
      EXPLAIN SELECT id FROM external_link
      WHERE resource_type = 'issue' AND metadata LIKE '%"deferredIssueEdit":%'
      ORDER BY id LIMIT 20`)) as { "QUERY PLAN": string }[];
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "external_link_deferred_issue_idx",
    );
  });
});

it.each(githubFields)(
  "imports a newer deferred $provider $field webhook over an older queued local repair",
  async ({ provider, field }) => {
    const { task, integration, link } = await seed(provider);
    const version = "2026-09-30T00:00:03Z";
    const initial = field === "state" ? "open" : "B";
    const latest = field === "state" ? "closed" : "C";
    await setTask(task.id, {
      [field === "state" ? "status" : field]:
        field === "state" ? "to-do" : initial,
    });
    await setMetadata(link.id, {
      lastSync: {
        [field]: inboundStamp(undefined, initial, provider, version),
      },
    });
    await deferTaskSync(app.db, link, integration, [field]);
    m.read.mockRejectedValueOnce(
      new Error("confirmation temporarily unavailable"),
    );
    await deliverField(field, latest, version);
    expect((await metadata(link.id)).deferredIssueEdit.fields).toContain(field);
    m.read.mockResolvedValue({
      title: "C",
      body: "C",
      state: "closed",
      updated_at: version,
    });
    await replay();
    const row = await current(task.id);
    expect(field === "state" ? row?.status : row?.[field]).toBe(
      field === "state" ? "done" : latest,
    );
    expect(m.write).not.toHaveBeenCalled();
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it.for(providerFields)(
  "keeps a newer local $provider $field repair over an older deferred inbound job",
  async ({ provider, field }, ctx) => {
    requireGiteaDouble(provider, ctx);
    const { task, integration, link } = await seed(provider);
    await setMetadata(link.id, "{}");
    await deferIssueEdit(app.db, link, integration, [field]);
    const latest = field === "state" ? "closed" : "C";
    await setTask(task.id, {
      [field === "state" ? "status" : field]:
        field === "state" ? "done" : latest,
    });
    await deferTaskSync(app.db, link, integration, [field]);
    m.read.mockResolvedValue({
      title: "A",
      body: "A",
      state: "open",
      updated_at: "2026-09-30T00:00:03Z",
    });
    await replay();
    expect(m.write).toHaveBeenCalledWith(
      expect.objectContaining({
        [field === "description" ? "body" : field]:
          field === "description" ? expect.stringContaining("C") : latest,
      }),
    );
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
  },
);

it("reconciles an existing overlapping inbound/repair job from the current provider value", async () => {
  const { task, integration, link } = await seed();
  await setMetadata(link.id, "{}");
  await deferIssueEdit(app.db, link, integration, ["title"]);
  const queued = await metadata(link.id);
  queued.deferredIssueEdit.repairFields = ["title"];
  await setMetadata(link.id, queued);
  m.read.mockResolvedValue({
    title: "C",
    body: "body",
    state: "open",
    updated_at: "2026-09-30T00:00:03Z",
  });
  await replay();
  expect((await current(task.id))?.title).toBe("C");
  expect(m.write).not.toHaveBeenCalled();
});

const failedCases = (entries: { provider: string; field: IssueField }[]) =>
  entries.flatMap((entry) =>
    [false, true].map((failed) => ({ ...entry, failed })),
  );
it.each(failedCases(githubFields))(
  "retires an old $provider $field intent after repository reconfiguration (failed=$failed)",
  async ({ provider, field, failed }) => {
    const { task, integration, link } = await seed(provider);
    await setMetadata(link.id, "{}");
    const older = field === "state" ? "closed" : "A";
    const fresh = field === "state" ? "open" : "new-repo-value";
    const write = vi.fn(async (_value: string) => {
      await setIntegration(integration.id, {
        config: JSON.stringify({
          ...JSON.parse(integration.config),
          repositoryName: "new-repo",
        }),
      });
      await updateExternalLink(app.db, link.id, {
        outbound: {
          field,
          value: fresh,
          intentId: "new-repo-intent",
          pending: true,
        },
      });
      if (failed) throw new Error("old repository request failed");
      return "2026-09-30T00:00:02Z";
    });
    const result = syncLatestTaskValue(
      app.db,
      app.get(EventBus),
      task.id,
      integration.projectId,
      link,
      field,
      older,
      write,
      undefined,
      integration,
    );
    if (failed)
      await expect(result).rejects.toThrow("old repository request failed");
    else await result;
    const stamp = (await metadata(link.id)).lastSync[field];
    const oldIntent = stamp.outbound.find(
      (entry: { intentId: string }) => entry.intentId !== "new-repo-intent",
    );
    expect(oldIntent).toMatchObject({
      pending: false,
      uncertain: false,
      cancelled: true,
    });
    expect(
      stamp.outbound.find(
        (entry: { intentId: string }) => entry.intentId === "new-repo-intent",
      ),
    ).toMatchObject({ pending: true });
    await deliverField(field, older, "2026-09-30T00:00:03Z", "new-repo");
    const row = await current(task.id);
    expect(field === "state" ? row?.status : row?.[field]).toBe(
      field === "state" ? "done" : older,
    );
    expect((await metadata(link.id)).deferredIssueEdit).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
    expect(m.write).not.toHaveBeenCalled();
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it.each(["title", "description"] as const)(
  "keeps the github %s webhook version when only the other field is confirmed",
  async (field) => {
    const { task, link } = await seed();
    const confirmedField = field === "title" ? "description" : "title";
    const before = { title: "title-0", description: "body-0" };
    const first = { title: "title-1", description: "body-1" };
    const latest = { title: "title-2", description: "body-2" };
    const t0 = "2026-09-30T00:00:00Z";
    const t1 = "2026-09-30T00:00:01Z";
    const t2 = "2026-09-30T00:00:02Z";
    const t3 = "2026-09-30T00:00:03Z";
    await setTask(task.id, before);
    await setMetadata(link.id, {
      lastSync: {
        [confirmedField]: inboundStamp(
          undefined,
          before[confirmedField],
          "github",
          t1,
        ),
        [field]: inboundStamp(undefined, before[field], "github", t0),
      },
    });
    // Confirmation reads the whole issue, including a newer edit to the other
    // field. Its timestamp must not be assigned to that field's older payload.
    m.read.mockResolvedValue({
      title: field === "title" ? latest.title : first.title,
      body: field === "description" ? latest.description : first.description,
      state: "open",
      updated_at: t3,
    });
    await handleIssueEdited(deps, {
      ...source(),
      action: "edited",
      issue: {
        number: 1,
        title: first.title,
        body: first.description,
        updated_at: t1,
        html_url: link.url,
      },
      changes: {
        title: { from: before.title },
        body: { from: before.description },
      },
    });
    expect(m.read).toHaveBeenCalled();
    expect((await current(task.id))?.[field]).toBe(first[field]);
    expect((await metadata(link.id)).lastSync[field].inboundUpdatedAt).toBe(t1);
    await deliverField(field, latest[field], t2);
    expect((await current(task.id))?.[field]).toBe(latest[field]);
  },
);
// The Gitea/GitLab cases are in test/integration/gitea-deferred-issue-edits.test.ts.

it.for(["github", "gitea"])(
  "keeps %s issues closed when orphaned replay finds a custom final workflow task",
  async (provider, ctx) => {
    requireGiteaDouble(provider, ctx);
    const { task, integration, link } = await seed(provider);
    const finalColumn = await insertRow(app.db, ColumnEntity, {
      projectId: task.projectId,
      name: "Released",
      slug: "released",
      position: 10,
      isFinal: true,
    });
    await insertRow(app.db, WorkflowRuleEntity, {
      projectId: task.projectId,
      integrationType: provider,
      eventType: "issue_closed",
      columnId: finalColumn.id,
    });
    await setTask(task.id, { status: "released", columnId: finalColumn.id });
    // A genuine remote close has already been applied through the workflow.
    // An older writer was orphaned; its stale delivery still needs replay.
    const stamp = inboundStamp(
      outboundStamp(undefined, "closed", undefined, {
        intentId: "old-close",
        pending: true,
      }),
      "closed",
      provider,
      "2026-09-30T00:00:03Z",
    );
    const orphan = stamp.outbound?.find(
      (entry) => entry.intentId === "old-close",
    );
    if (!orphan) throw new Error("Missing orphaned close intent");
    orphan.timestamp = new Date(Date.now() - 300_001).toISOString();
    orphan.startedAt = orphan.timestamp;
    await setMetadata(link.id, { lastSync: { state: stamp } });
    m.read.mockResolvedValue({
      title: "B",
      body: "old body",
      state: "closed",
      updated_at: "2026-09-30T00:00:03Z",
    });
    await deferIssueEdit(app.db, link, integration, ["state"]);
    await replay();
    expect((await current(task.id))?.status).toBe("released");
    expect(m.write).not.toHaveBeenCalledWith(
      expect.objectContaining({ state: "open" }),
    );
  },
);

it.each(
  (["github", "gitea"] as const).flatMap((provider) =>
    [true, false].map((isFinal) => ({ provider, isFinal })),
  ),
)(
  "repairs a late $provider close using the custom column's final flag ($isFinal)",
  async ({ provider, isFinal }) => {
    const { task, integration, link } = await seed(provider);
    const column = await insertRow(app.db, ColumnEntity, {
      projectId: task.projectId,
      name: "Custom",
      slug: "custom",
      position: 10,
      isFinal,
    });
    await setMetadata(link.id, "{}");
    const write = vi.fn(async (_state: string) => {
      if (write.mock.calls.length === 1)
        await setTask(task.id, { status: column.slug, columnId: column.id });
      return "2026-09-30T00:00:04Z";
    });
    await syncLatestTaskValue(
      app.db,
      app.get(EventBus),
      task.id,
      task.projectId,
      link,
      "state",
      "closed",
      write,
      undefined,
      integration,
    );
    expect(write.mock.calls.map(([state]) => state)).toEqual(
      isFinal ? ["closed"] : ["closed", "open"],
    );
    expect((await metadata(link.id)).state).toBe(isFinal ? "closed" : "open");
  },
);
