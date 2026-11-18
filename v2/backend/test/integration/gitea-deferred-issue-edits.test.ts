// The Gitea cases of tests/api-integration/deferred-issue-edits.test.ts (the
// GitHub cases are in github-deferred-issue-edits.test.ts, whose bodies these
// share). The Gitea client is replaced by the previous suite's mock, so the
// real Gitea webhook handlers and deferred-edit access run against it.
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { WorkflowRuleEntity } from "../../src/database/entities/workflow-rule.entity";
import { EventBus } from "../../src/events/event-bus";
import { DeferredIssueEditsJob } from "../../src/integrations/git-shared/deferred-issue-edits.job";
import {
  handleGiteaIssueEdited,
  type IssueEditedPayload,
} from "../../src/integrations/gitea/webhooks/issue-edited";
import { handleGiteaIssueState } from "../../src/integrations/gitea/webhooks/issue-state";
import {
  deferIssueEdit,
  deferTaskSync,
} from "../../src/integrations/links/defer-issue-edit";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import {
  inboundStamp,
  outboundStamp,
} from "../../src/integrations/links/sync-echo";
import { syncLatestTaskValue } from "../../src/integrations/links/sync-latest-task-value";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type IssueField = "title" | "description" | "state";

const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => ({
    getIssue: () => m.read(),
    updateIssue: (
      _owner: string,
      _repo: string,
      _number: number,
      params: Record<string, unknown>,
    ) => m.write(params),
  }),
}));

let app: TestApp;
let job: DeferredIssueEditsJob;
let publish: MockInstance<EventBus["publish"]>;

beforeAll(async () => {
  app = await createTestApp();
  job = app.get(DeferredIssueEditsJob);
  publish = vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  publish.mockClear();
  m.write.mockReset().mockResolvedValue({ updated_at: "2026-09-30T00:00:04Z" });
  m.read.mockReset().mockResolvedValue({
    title: "A",
    body: "recovered body",
    state: "closed",
    updated_at: "2026-09-30T00:00:03Z",
  });
});

/** The previous suite's provider switch; every case here is Gitea. */
function requireGiteaDouble(_provider: string, _ctx: unknown) {}

const replay = () => job.replayDeferredIssueEdits();

async function seed(type = "gitea") {
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
  const integration = await insertRow(app.db, IntegrationEntity, {
    projectId: project.id,
    type,
    config: JSON.stringify({
      baseUrl: "https://git.example",
      accessToken: "test-secret-never-metadata",
      repositoryOwner: "owner",
      repositoryName: "repo",
      installationId: 10,
      repositoryId: 20,
    }),
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

/** The signed delivery's integration (every case seeds exactly one). */
async function signedIntegrationId() {
  const integration = await app.db.findOneBy(IntegrationEntity, {
    type: "gitea",
  });
  return integration?.id ?? "missing";
}

/** The webhook's repository (possibly renamed). */
function source(repositoryName = "repo") {
  return {
    repository: {
      owner: { login: "owner" },
      name: repositoryName,
      html_url: `https://git.example/owner/${repositoryName}`,
    },
  };
}

const deps = undefined;
async function handleIssueEdited(
  _deps: unknown,
  payload: Omit<IssueEditedPayload, "issue"> & {
    issue: Omit<IssueEditedPayload["issue"], "html_url"> & {
      html_url?: string;
    };
  },
) {
  await handleGiteaIssueEdited(
    app.db,
    app.get(EventBus),
    payload as IssueEditedPayload,
    await signedIntegrationId(),
  );
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
    await handleGiteaIssueState(
      app.db,
      app.get(EventBus),
      payload,
      value === "closed" ? "closed" : "open",
      await signedIntegrationId(),
    );
}

const fields = ["title", "description", "state"] as const;
const giteaFields = fields.map((field) => ({ provider: "gitea", field }));
const providerFields = giteaFields;

it.for(["gitea"])(
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

it("preserves the final gitea value when colliding-version webhooks arrive in reverse", async () => {
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

it.for(["gitea"])(
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

it.each(collisionCases(giteaFields))(
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

const uncertainCountCases = (
  entries: { provider: string; field: IssueField }[],
) => entries.flatMap((entry) => [1, 2].map((count) => ({ ...entry, count })));

it.each(uncertainCountCases(giteaFields))(
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

it.each(giteaFields)(
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

it("validates each changed gitea field when a shared confirmation GET becomes stale", async () => {
  const { task, link } = await seed();
  const version = "2026-09-30T00:00:03Z";
  await setTask(task.id, { title: "A", description: "A" });
  await setMetadata(link.id, {
    lastSync: {
      title: inboundStamp(undefined, "A", "gitea", version),
      description: inboundStamp(undefined, "A", "gitea", version),
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

it("preserves a newer local edit committed during gitea provider confirmation", async () => {
  const { task, link } = await seed();
  const version = "2026-09-30T00:00:03Z";
  await setTask(task.id, { title: "A" });
  await setMetadata(link.id, {
    lastSync: { title: inboundStamp(undefined, "A", "gitea", version) },
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

it.each([1, 2])(
  "retires uncertain intents after queued gitea correction so future genuine edits apply (uncertain=%s)",
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

it.for([
  { provider: "gitea", mode: "webhook" },
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

const changeCases = (entries: { provider: string; field: IssueField }[]) =>
  entries.flatMap((entry) =>
    ["rebound", "disabled", "credentials"].map((change) => ({
      ...entry,
      change,
    })),
  );

it.each(changeCases(giteaFields))(
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

const modeCases = (entries: { provider: string; field: IssueField }[]) =>
  entries.flatMap((entry) =>
    ["inbound", "queued"].map((mode) => ({ ...entry, mode })),
  );

it.each(modeCases(giteaFields))(
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

it.each(giteaFields)(
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

it.each(giteaFields)(
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

const failedCases = (entries: { provider: string; field: IssueField }[]) =>
  entries.flatMap((entry) =>
    [false, true].map((failed) => ({ ...entry, failed })),
  );

it.each(failedCases(giteaFields))(
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

it.each(["title", "description"] as const)(
  "keeps the gitea %s webhook version when only the other field is confirmed",
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
          "gitea",
          t1,
        ),
        [field]: inboundStamp(undefined, before[field], "gitea", t0),
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

it.for(["gitea"])(
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
