// The Gitea cases of tests/api-integration/pull-request-task-links.test.ts
// (the GitHub cases are in github-pull-request-task-links.test.ts).
import { createHmac } from "node:crypto";
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
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { resolvePullRequestTask } from "../../src/integrations/git-shared/resolve-pull-request-task";
import { GiteaImportService } from "../../src/integrations/gitea/import/gitea-import.service";
import { GiteaWebhookService } from "../../src/integrations/gitea/webhook/gitea-webhook.service";
import { handleGiteaPullRequestClosed } from "../../src/integrations/gitea/webhooks/pull-request-closed";
import { handleGiteaPullRequestOpened } from "../../src/integrations/gitea/webhooks/pull-request-opened";
import { handleGiteaPush } from "../../src/integrations/gitea/webhooks/push";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const remote = vi.hoisted(() => ({ listIssues: vi.fn(), listPulls: vi.fn() }));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => ({
    listIssues: remote.listIssues,
    listPulls: remote.listPulls,
  }),
}));

const repositoryUrl = "https://git.example.com/acme/repo";
const repository = {
  owner: { login: "acme" },
  name: "repo",
  html_url: repositoryUrl,
};
const payload = (
  title = "Copy message text",
  body = "Closes #61",
  branch = "unmatched-branch",
) => ({
  action: "opened",
  repository,
  pull_request: {
    number: 109,
    title,
    body: body as string | null,
    head: { ref: branch },
    html_url: `${repositoryUrl}/pull/109`,
    state: "open",
    draft: false,
    merged: false,
    user: { login: "octocat" },
  },
});

describe("gitea pull request task identity", () => {
  let app: TestApp;
  let events: EventBus;
  let publish: MockInstance<EventBus["publish"]>;
  let fixture: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    app = await createTestApp();
    events = app.get(EventBus);
  });
  afterAll(() => app.close());

  async function createFixture(slug = "KAN", repo = "repo") {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug,
    });
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "gitea",
      isActive: true,
      config: JSON.stringify({
        repositoryOwner: "acme",
        repositoryName: repo,
        installationId: 1,
        repositoryId: repo === "repo" ? 2 : 3,
        verifiedGithubAccountId: "4",
        verifiedByUserId: member.user.id,
        accessToken: "test-only-token",
        webhookSecret: "test-only-webhook-secret",
        baseUrl: "https://git.example.com",
        branchPattern: "{slug}-{number}",
      }),
    });
    const tasks = [];
    for (const number of [42, 61])
      tasks.push(
        await createTask(app.db, {
          projectId: project.id,
          number,
          title: `Task ${number}`,
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          position: number,
        }),
      );
    return {
      project,
      columns,
      integration,
      intended: tasks[0]!,
      unrelated: tasks[1]!,
    };
  }

  const runImport = async () => {
    const result = await app
      .get(GiteaImportService)
      .importIssues(fixture.project.id);
    expect(result.errors).toBeUndefined();
  };
  const open = (event = payload()) =>
    handleGiteaPullRequestOpened(app.db, events, event, fixture.integration.id);
  const openUnscoped = (event = payload()) =>
    handleGiteaPullRequestOpened(app.db, events, event);
  const openSigned = async () => {
    const body = JSON.stringify(payload());
    const signature = createHmac("sha256", "test-only-webhook-secret")
      .update(body)
      .digest("hex");
    expect(
      await app
        .get(GiteaWebhookService)
        .handle(fixture.integration.id, body, signature, "pull_request"),
    ).toEqual({ success: true });
  };
  const linkIssue = (
    taskId: string,
    externalId = "61",
    integrationId = fixture.integration.id,
    resourceType = "issue",
  ) =>
    insertRow(app.db, ExternalLinkEntity, {
      taskId,
      integrationId,
      resourceType,
      externalId,
      url: `${repositoryUrl}/issues/${externalId}`,
    });
  const links = () =>
    app.db.find(ExternalLinkEntity, {
      where: { resourceType: "pull_request", externalId: "109" },
    });
  const task = (id: string) => app.db.findOne(TaskEntity, { where: { id } });
  const expectUnchanged = async () => {
    expect(await links()).toHaveLength(0);
    expect((await task(fixture.intended.id))?.status).toBe("to-do");
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  };

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    // Event delivery is not under test; keep subscribers from running after
    // the next test has reset the database.
    publish = vi.spyOn(events, "publish").mockResolvedValue(undefined);
    fixture = await createFixture();
    remote.listIssues.mockReset().mockResolvedValue([]);
    remote.listPulls.mockReset().mockResolvedValue([payload().pull_request]);
  });
  afterEach(() => publish.mockRestore());

  it("links remote issue 61 to task 42 without advancing local task 61", async () => {
    await linkIssue(fixture.intended.id);
    await open();
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
    expect(await task(fixture.intended.id)).toMatchObject({
      status: "in-review",
      columnId: fixture.columns.inReview.id,
    });
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("checks for an existing PR link only once per integration", async () => {
    await linkIssue(fixture.intended.id);
    // The previous suite counted `db.query.externalLinkTable.findFirst`; the
    // lookup is now a query builder on the shared entity manager.
    const lookup = vi.spyOn(app.db, "createQueryBuilder");
    try {
      await open();
      expect(
        lookup.mock.calls.filter(
          ([entity]) => (entity as unknown) === ExternalLinkEntity,
        ),
      ).toHaveLength(1);
    } finally {
      lookup.mockRestore();
    }
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
  });

  it("does not let a separatorless task label override the linked issue", async () => {
    await linkIssue(fixture.intended.id);
    await open(payload("Refactor task61 renderer"));
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("merges the mapped task without completing the same-numbered local task", async () => {
    await linkIssue(fixture.intended.id);
    await open();
    const event = payload();
    await handleGiteaPullRequestClosed(app.db, events, {
      ...event,
      action: "closed",
      pull_request: {
        ...event.pull_request,
        state: "closed",
        merged: true,
        merged_at: "2026-01-01T00:00:00Z",
      },
    });
    expect((await task(fixture.intended.id))?.status).toBe("done");
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("imports a PR using the remote issue mapping", async () => {
    await linkIssue(fixture.intended.id);
    await runImport();
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("imports an explicit task key without an issue link", async () => {
    remote.listPulls.mockResolvedValue([
      payload("KAN-42: Fix copy", "").pull_request,
    ]);
    await runImport();
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("resolves issue links written inside the import transaction", async () => {
    await app.db.transaction(async (tx) => {
      await insertRow(tx, ExternalLinkEntity, {
        taskId: fixture.intended.id,
        integrationId: fixture.integration.id,
        resourceType: "issue",
        externalId: "61",
        url: `${repositoryUrl}/issues/61`,
      });
      const resolved = await resolvePullRequestTask(tx, {
        integrationId: fixture.integration.id,
        projectId: fixture.project.id,
        projectSlug: fixture.project.slug,
        config: { branchPattern: "{slug}-{number}" },
        repositoryUrl,
        pullRequest: payload().pull_request,
      });
      expect(resolved?.id).toBe(fixture.intended.id);
    });
  });

  it("does not import a PR without a matching issue link", async () => {
    await runImport();
    await expectUnchanged();
  });

  it("preserves an existing PR association during import", async () => {
    await linkIssue(fixture.intended.id);
    await linkIssue(
      fixture.unrelated.id,
      "109",
      fixture.integration.id,
      "pull_request",
    );
    await runImport();
    expect(await links()).toMatchObject([{ taskId: fixture.unrelated.id }]);
    expect((await task(fixture.intended.id))?.status).toBe("to-do");
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("accepts duplicate issue links pointing to the same task", async () => {
    await linkIssue(fixture.intended.id);
    await linkIssue(fixture.intended.id);
    await open();
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
  });

  it("recognizes a project key in a conventional commit title", async () => {
    await open(
      payload(
        "feat(KAN-42): copy message text",
        "Closes #61",
        "codex/kan-42-copy-message-text",
      ),
    );
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("links a PR whose description contains the task link", async () => {
    const taskLink = `https://kaneo.example.com/dashboard/workspace/w/project/${fixture.project.id}/task/${fixture.intended.id}`;
    await open(payload("Copy message text", `Implements ${taskLink}`));
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("prefers a mapped issue reference over a task link", async () => {
    await linkIssue(fixture.intended.id);
    const taskLink = `https://kaneo.example.com/dashboard/workspace/w/project/${fixture.project.id}/task/${fixture.unrelated.id}`;
    await open(payload("Copy message text", `Closes #61\n\n${taskLink}`));
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
  });

  it("skips a PR that links two tasks", async () => {
    const taskLink = (id: string) =>
      `https://kaneo.example.com/dashboard/workspace/w/project/${fixture.project.id}/task/${id}`;
    await open(
      payload(
        "Copy message text",
        `${taskLink(fixture.intended.id)} ${taskLink(fixture.unrelated.id)}`,
      ),
    );
    await expectUnchanged();
  });

  it("skips a PR that also links a task in another project", async () => {
    const other = await createFixture("OTHER", "other-repo");
    const taskLink = (projectId: string, taskId: string) =>
      `https://kaneo.example.com/dashboard/workspace/w/project/${projectId}/task/${taskId}`;
    await open(
      payload(
        "Copy message text",
        `${taskLink(fixture.project.id, fixture.intended.id)} ${taskLink(other.project.id, other.intended.id)}`,
      ),
    );
    await expectUnchanged();
  });

  it("falls back to the task link when the task key is stale", async () => {
    const taskLink = `https://kaneo.example.com/dashboard/workspace/w/project/${fixture.project.id}/task/${fixture.intended.id}`;
    await open(payload("KAN-999: copy message text", taskLink));
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
  });

  it("does not follow a task link into another project", async () => {
    const other = await createFixture("OTHER", "other-repo");
    const taskLink = `https://kaneo.example.com/dashboard/workspace/w/project/${other.project.id}/task/${other.intended.id}`;
    await open(payload("Copy message text", taskLink));
    await expectUnchanged();
    expect((await task(other.intended.id))?.status).toBe("to-do");
  });

  it("does not infer a local task from an unmapped remote issue", async () => {
    await open();
    await expectUnchanged();
  });

  it("does not use an issue link from another integration", async () => {
    const other = await createFixture("OTHER", "other-repo");
    await linkIssue(fixture.intended.id, "61", other.integration.id);
    await open();
    await expectUnchanged();
  });

  it("does not use a branch link as an issue link", async () => {
    await linkIssue(fixture.intended.id, "61", fixture.integration.id, "branch");
    await open();
    await expectUnchanged();
  });

  it("does not use an issue link whose task belongs to another project", async () => {
    const other = await createFixture("OTHER", "other-repo");
    await linkIssue(other.intended.id);
    await open();
    await expectUnchanged();
    expect((await task(other.intended.id))?.status).toBe("to-do");
  });

  it("skips conflicting duplicate issue links", async () => {
    await linkIssue(fixture.intended.id);
    await linkIssue(fixture.unrelated.id);
    await open();
    await expectUnchanged();
  });

  it("skips closing references mapped to different tasks", async () => {
    await linkIssue(fixture.intended.id);
    await linkIssue(fixture.unrelated.id, "88");
    await open(payload("Copy message text", "Closes #61, fixes #88"));
    await expectUnchanged();
  });

  it("accepts multiple issue links to the same task", async () => {
    await linkIssue(fixture.intended.id);
    await linkIssue(fixture.intended.id, "88");
    await open(payload("Copy message text", "Closes #61, fixes #88"));
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
  });

  it("preserves explicit branch precedence over an issue reference", async () => {
    await linkIssue(fixture.unrelated.id);
    await open(payload("Copy message text", "Closes #61", "kan-42-copy"));
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
  });

  it("preserves an existing PR association on a reopened delivery", async () => {
    await linkIssue(
      fixture.unrelated.id,
      "109",
      fixture.integration.id,
      "pull_request",
    );
    await open({
      ...payload("fix(KAN-42): copy message text"),
      action: "reopened",
    });
    expect(await links()).toMatchObject([{ taskId: fixture.unrelated.id }]);
    expect((await task(fixture.intended.id))?.status).toBe("to-do");
    expect((await task(fixture.unrelated.id))?.status).toBe("to-do");
  });

  it("moves a completed task back to review when a new PR opens", async () => {
    await linkIssue(fixture.intended.id);
    await app.db.update(
      TaskEntity,
      { id: fixture.intended.id },
      { status: "done", columnId: fixture.columns.done.id },
    );
    await open();
    expect(await links()).toMatchObject([{ taskId: fixture.intended.id }]);
    expect(await task(fixture.intended.id)).toMatchObject({
      status: "in-review",
      columnId: fixture.columns.inReview.id,
    });
  });

  describe("pushes to a completed task", () => {
    const branch = "kan-42-slice-2";
    const push = (after?: string, ref = `refs/heads/${branch}`) =>
      handleGiteaPush(
        app.db,
        events,
        { after, ref, repository },
        fixture.integration.id,
      );
    const complete = () =>
      app.db.update(
        TaskEntity,
        { id: fixture.intended.id },
        { status: "done", columnId: fixture.columns.done.id },
      );

    beforeEach(complete);

    it("moves the task back to progress for a new branch", async () => {
      await push();
      expect((await task(fixture.intended.id))?.status).toBe("in-progress");
    });

    it("ignores a tag push", async () => {
      await push(undefined, "refs/tags/kan-42");
      expect((await task(fixture.intended.id))?.status).toBe("done");
    });

    it("ignores a push that deletes the branch", async () => {
      await push("0".repeat(40));
      expect((await task(fixture.intended.id))?.status).toBe("done");
    });

    it("keeps the task done for a push to an already linked branch", async () => {
      await push();
      await complete();
      await push();
      expect((await task(fixture.intended.id))?.status).toBe("done");
    });
  });

  it("skips ambiguous candidates across repository integrations for an unscoped delivery", async () => {
    const other = await createFixture("OTHER");
    await linkIssue(fixture.intended.id);
    await linkIssue(other.intended.id, "61", other.integration.id);
    await openUnscoped();
    await expectUnchanged();
    expect((await task(other.intended.id))?.status).toBe("to-do");
  });

  it("preserves an existing PR association in another integration for an unscoped delivery", async () => {
    const other = await createFixture("OTHER");
    await linkIssue(fixture.intended.id);
    await linkIssue(
      other.intended.id,
      "109",
      other.integration.id,
      "pull_request",
    );
    await openUnscoped();
    expect(await links()).toMatchObject([{ taskId: other.intended.id }]);
    expect((await task(fixture.intended.id))?.status).toBe("to-do");
    expect((await task(other.intended.id))?.status).toBe("to-do");
  });

  it("resolves a signed delivery within its integration despite another project's candidate", async () => {
    const other = await createFixture("OTHER");
    await linkIssue(fixture.intended.id);
    await linkIssue(other.intended.id, "61", other.integration.id);
    await openSigned();
    expect(await links()).toMatchObject([
      {
        taskId: fixture.intended.id,
        integrationId: fixture.integration.id,
      },
    ]);
    expect((await task(fixture.intended.id))?.status).toBe("in-review");
    expect((await task(other.intended.id))?.status).toBe("to-do");
  });

  it("does not let another integration's PR link block a signed delivery", async () => {
    const other = await createFixture("OTHER");
    await linkIssue(fixture.intended.id);
    await linkIssue(
      other.intended.id,
      "109",
      other.integration.id,
      "pull_request",
    );
    await openSigned();
    expect((await links()).map((link) => link.taskId).sort()).toEqual(
      [fixture.intended.id, other.intended.id].sort(),
    );
    expect((await task(fixture.intended.id))?.status).toBe("in-review");
    expect((await task(other.intended.id))?.status).toBe("to-do");
  });

  it("does not mutate another integration with the signed integration's authority", async () => {
    const other = await createFixture("OTHER");
    await linkIssue(other.intended.id, "61", other.integration.id);
    await open();
    await expectUnchanged();
    expect((await task(other.intended.id))?.status).toBe("to-do");
  });

  it("rejects a signed integration that does not match the repository", async () => {
    const other = await createFixture("OTHER", "other-repo");
    await linkIssue(fixture.intended.id);
    await handleGiteaPullRequestOpened(
      app.db,
      events,
      payload(),
      other.integration.id,
    );
    await expectUnchanged();
    expect((await task(other.intended.id))?.status).toBe("to-do");
  });

  it("rejects an inactive signed integration", async () => {
    await linkIssue(fixture.intended.id);
    await app.db.update(
      IntegrationEntity,
      { id: fixture.integration.id },
      { isActive: false },
    );
    await open();
    await expectUnchanged();
  });
});
