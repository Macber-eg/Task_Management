// The Gitea cases of tests/api-integration/inbound-state-echo.test.ts.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { handleGiteaIssueState } from "../../src/integrations/gitea/webhooks/issue-state";
import { outboundStamp } from "../../src/integrations/links/sync-echo";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const m = vi.hoisted(() => ({ state: "open" }));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => ({ getIssue: async () => ({ state: m.state }) }),
}));

let app: TestApp;
let events: EventBus;

beforeAll(async () => {
  app = await createTestApp();
  events = app.get(EventBus);
  vi.spyOn(events, "publish").mockResolvedValue(undefined);
});
afterAll(() => app.close());
beforeEach(() => resetTestDatabase(app.dataSource));

it.each(["closed", "open"] as const)(
  "gitea ignores a delayed %s state echo and accepts a later genuine edit",
  async (delayed) => {
    const current = delayed === "closed" ? "open" : "closed";
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      number: 1,
      title: "card",
      status: current === "closed" ? "done" : "to-do",
    });
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "gitea",
      config: JSON.stringify({
        baseUrl: "https://git.example",
        repositoryOwner: "owner",
        repositoryName: "repo",
        accessToken: "test-only",
      }),
    });
    m.state = current;
    const stamp = outboundStamp(
      outboundStamp(undefined, delayed, "2026-09-30T00:00:01Z"),
      current,
      "2026-09-30T00:00:02Z",
    );
    await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://git.example/owner/repo/issues/1",
      metadata: JSON.stringify({
        createdFrom: "gitea",
        state: current,
        lastSync: { state: stamp },
      }),
    });
    const payload = {
      action: delayed === "closed" ? "closed" : "reopened",
      issue: {
        number: 1,
        title: "card",
        html_url: "https://git.example/owner/repo/issues/1",
        state: delayed,
        updated_at: "2026-09-30T00:00:01Z",
      },
      repository: {
        name: "repo",
        owner: { login: "owner" },
        html_url: "https://git.example/owner/repo",
      },
    };
    const apply = () =>
      handleGiteaIssueState(app.db, events, payload, delayed, integration.id);
    const status = async () =>
      (await app.db.findOneBy(TaskEntity, { id: task.id }))?.status;

    await apply();
    expect(await status()).toBe(current === "closed" ? "done" : "to-do");

    m.state = delayed;
    payload.issue.updated_at = "2026-09-30T00:00:03Z";
    await apply();
    expect(await status()).toBe(delayed === "closed" ? "done" : "to-do");
  },
);
