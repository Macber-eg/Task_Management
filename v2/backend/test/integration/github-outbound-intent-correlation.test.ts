// Ported from tests/api-integration/outbound-intent-correlation.test.ts.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import {
  inboundEcho,
  withEchoConfirmation,
} from "../../src/integrations/links/inbound-echo";
import { inboundStamp, type SyncStamp } from "../../src/integrations/links/sync-echo";
import { syncLatestTaskValue } from "../../src/integrations/links/sync-latest-task-value";
import { withIntegrationLink } from "../../src/integrations/links/with-integration-link";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;
let events: EventBus;

beforeAll(async () => {
  app = await createTestApp();
  events = app.get(EventBus);
  vi.spyOn(events, "publish").mockResolvedValue(undefined);
});
afterAll(() => app.close());
beforeEach(() => resetTestDatabase(app.dataSource));

async function seed(
  task: Partial<TaskEntity>,
  integration: { type: string; config: string } = {
    type: "github",
    config: "{}",
  },
) {
  const { workspace } = await createWorkspaceMember(app.db);
  const { project } = await createProjectFixture(app.db, {
    workspaceId: workspace.id,
  });
  const row = await createTask(app.db, {
    projectId: project.id,
    number: 1,
    ...task,
  });
  const binding = await insertRow(app.db, IntegrationEntity, {
    projectId: project.id,
    ...integration,
  });
  const link = await insertRow(app.db, ExternalLinkEntity, {
    taskId: row.id,
    integrationId: binding.id,
    resourceType: "issue",
    externalId: "1",
    url: "https://provider.example/1",
  });
  return { project, task: row, integration: binding, link };
}

async function linkMetadata(linkId: string) {
  const link = await app.db.findOneBy(ExternalLinkEntity, { id: linkId });
  return JSON.parse(link?.metadata ?? "{}");
}

async function current(taskId: string) {
  return app.db.findOneBy(TaskEntity, { id: taskId });
}

it.each([
  { colliding: false, legitimate: true, timeout: false },
  { colliding: true, legitimate: true, timeout: false },
  { colliding: true, legitimate: false, timeout: false },
  { colliding: true, legitimate: true, timeout: true },
])(
  "correlates observed edits without losing intervening edits (collision=$colliding, legitimate=$legitimate, timeout=$timeout)",
  async ({ colliding, legitimate, timeout }) => {
    const { project, task, integration, link } = await seed({ title: "B" });
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    let remote = "A";
    const outbound = syncLatestTaskValue(
      app.db,
      events,
      task.id,
      project.id,
      link,
      "title",
      "A",
      async (value) => {
        remote = value;
        await response;
        return "2026-09-30T00:00:01Z";
      },
      async () => remote,
    );
    await vi.waitFor(async () => {
      expect(
        (await linkMetadata(link.id)).lastSync?.title?.outbound?.[0].pending,
      ).toBe(true);
    });
    const pending = await linkMetadata(link.id);
    await updateExternalLink(app.db, link.id, {
      metadata: {
        lastSync: {
          title: inboundStamp(pending.lastSync.title, "B", "github"),
        },
      },
    });
    remote = legitimate ? "A" : "B";
    const observedVersion = colliding
      ? "2026-09-30T00:00:01Z"
      : "2026-09-30T00:00:03Z";
    const inbound = withEchoConfirmation(
      app.db,
      async () => remote,
      (providerValue) =>
        withIntegrationLink(
          app.db,
          link,
          integration,
          async (tx, _afterCommit, locked) => {
            const stamp = JSON.parse(locked.metadata ?? "{}").lastSync
              ?.title as SyncStamp | undefined;
            if (
              !inboundEcho(stamp, "A", observedVersion, providerValue, {
                linkId: link.id,
                field: "title",
              })
            )
              await tx.update(TaskEntity, { id: task.id }, { title: "A" });
          },
        ),
    );
    const inboundResult = inbound.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(async () => {
      expect(
        (await linkMetadata(link.id)).lastSync?.title?.outbound?.[0]
          .observedUpdatedAt,
      ).toBe(observedVersion);
    });
    if (timeout) expect(await inboundResult).toBeInstanceOf(Error);
    release();
    await Promise.all([outbound, inboundResult]);
    expect((await current(task.id))?.title).toBe(legitimate ? "A" : "B");
    expect(remote).toBe(legitimate ? "A" : "B");
  },
  15000,
);

it("stops correction when a disconnect races the post-response task read", async () => {
  const { project, task, link } = await seed({ title: "B" });
  let responseReceived = false;
  // The previous suite spied on the task read; `findLinkedTask` reads the
  // task through `findOne` on the same manager.
  const findOne = app.db.findOne.bind(app.db);
  const read = vi
    .spyOn(app.db, "findOne")
    .mockImplementation(async (entity, options) => {
      if (responseReceived && entity === TaskEntity)
        await app.db.delete(ExternalLinkEntity, { id: link.id });
      return findOne(entity, options);
    });
  const write = vi.fn(async (_value: string) => {
    responseReceived = true;
    return "2026-09-30T00:00:01Z";
  });
  try {
    await syncLatestTaskValue(
      app.db,
      events,
      task.id,
      project.id,
      link,
      "title",
      "A",
      write,
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("A");
  } finally {
    read.mockRestore();
  }
});

it.each(
  (["title", "description", "state"] as const).flatMap((field) =>
    [false, true].map((aba) => ({ field, aba })),
  ),
)(
  "preserves a newer local $field edit during observed-value HTTP (ABA=$aba)",
  async ({ field, aba }) => {
    const { project, task, link } = await seed({
      title: "B",
      description: "B",
      status: "to-do",
    });
    const older = field === "state" ? "closed" : "A";
    const prior = field === "state" ? "open" : "B";
    let first = true;
    let remote = older;
    const write = vi.fn(async (value: string) => {
      remote = value;
      if (!first) return "2026-09-30T00:00:04Z";
      first = false;
      const stamp = (await linkMetadata(link.id)).lastSync[field];
      await updateExternalLink(app.db, link.id, {
        metadata: {
          lastSync: {
            [field]: inboundStamp(
              stamp,
              prior,
              "github",
              "2026-09-30T00:00:02Z",
            ),
          },
        },
        observedOutbound: {
          field,
          intentId: stamp.outbound[0].intentId,
          updatedAt: "2026-09-30T00:00:03Z",
        },
      });
      return "2026-09-30T00:00:01Z";
    });
    const column = field === "state" ? "status" : field;
    await syncLatestTaskValue(
      app.db,
      events,
      task.id,
      project.id,
      link,
      field,
      older,
      write,
      async () => {
        await app.db.transaction(async (tx) => {
          const set = (value: string) =>
            tx.query(
              `UPDATE task SET ${column} = $1, updated_at = $2 WHERE id = $3`,
              [value, task.updatedAt, task.id],
            );
          await set(field === "state" ? "in-progress" : "C");
          if (aba) await set(field === "state" ? "to-do" : "B");
        });
        return remote;
      },
    );
    const row = await current(task.id);
    expect(field === "state" ? row?.status : row?.[field]).toBe(
      field === "state" ? (aba ? "to-do" : "in-progress") : aba ? "B" : "C",
    );
    expect(remote).toBe(field === "state" ? "open" : aba ? "B" : "C");
    expect(write).toHaveBeenCalledTimes(2);
  },
);

it.each(
  (["github", "gitea"] as const).flatMap((provider) =>
    (["title", "description", "state"] as const).flatMap((field) =>
      ["retry", "read", "apply"].map((phase) => ({ provider, field, phase })),
    ),
  ),
)(
  "stops $field sync against a reconfigured provider ($provider/$phase)",
  async ({ provider, field, phase }) => {
    const { project, task, integration, link } = await seed(
      { title: "B", description: "B", status: "to-do" },
      {
        type: provider,
        config: JSON.stringify({ repositoryName: "old", accessToken: "fake" }),
      },
    );
    const older = field === "state" ? "closed" : "A";
    const reconfigure = () =>
      app.db.update(
        IntegrationEntity,
        { id: integration.id },
        {
          config: JSON.stringify({
            repositoryName: "new",
            accessToken: "fake",
          }),
        },
      );
    const write = vi.fn(async (_value: string) => {
      if (write.mock.calls.length === 1) {
        if (phase !== "retry") {
          const stamp = (await linkMetadata(link.id)).lastSync[field];
          await updateExternalLink(app.db, link.id, {
            metadata: {
              lastSync: {
                [field]: inboundStamp(
                  stamp,
                  field === "state" ? "open" : "B",
                  provider,
                  "2026-09-30T00:00:02Z",
                ),
              },
            },
            observedOutbound: {
              field,
              intentId: stamp.outbound[0].intentId,
              updatedAt: "2026-09-30T00:00:03Z",
            },
          });
        }
        if (phase !== "apply") await reconfigure();
      }
      return "2026-09-30T00:00:01Z";
    });
    const read = vi.fn(async () => {
      await reconfigure();
      return older;
    });
    await syncLatestTaskValue(
      app.db,
      events,
      task.id,
      project.id,
      link,
      field,
      older,
      write,
      read,
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(phase === "apply" ? 1 : 0);
    const row = await current(task.id);
    expect(field === "state" ? row?.status : row?.[field]).toBe(
      field === "state" ? "to-do" : "B",
    );
  },
);

it.each(["github", "gitea"])(
  "rejects a stale provider context before the initial %s write",
  async (provider) => {
    const { project, task, link } = await seed(
      { title: "A" },
      { type: provider, config: JSON.stringify({ repositoryName: "new" }) },
    );
    const write = vi.fn(async () => "2026-09-30T00:00:01Z");
    await syncLatestTaskValue(
      app.db,
      events,
      task.id,
      project.id,
      link,
      "title",
      "A",
      write,
      undefined,
      { type: provider, config: JSON.stringify({ repositoryName: "old" }) },
    );
    expect(write).not.toHaveBeenCalled();
  },
);
