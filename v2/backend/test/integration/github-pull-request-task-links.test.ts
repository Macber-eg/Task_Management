// Ported from tests/api-integration/pull-request-task-links.test.ts (GitHub cases).
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
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { resolvePullRequestTask } from "../../src/integrations/git-shared/resolve-pull-request-task";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { GitHubImportService } from "../../src/integrations/github/import/github-import.service";
import { handlePullRequestClosed } from "../../src/integrations/github/webhooks/pull-request-closed";
import { handlePullRequestOpened } from "../../src/integrations/github/webhooks/pull-request-opened";
import { handlePush } from "../../src/integrations/github/webhooks/push";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertGitHubIntegration } from "../support/fixtures/github-fixtures";
import {
  issuePage,
  OLD_GITHUB_DATE,
  pullsPage,
} from "../support/fixtures/github-import-pages";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { createTestApp, type TestApp } from "../support/test-app";

type PullRequest = ReturnType<typeof payload>["pull_request"];

const repositoryUrl = "https://github.com/acme/repo";
const payload = (
  title = "Copy message text",
  body = "Closes #61",
  branch = "unmatched-branch",
) => ({
  action: "opened",
  installation: { id: 1 },
  repository: {
    id: 2,
    owner: { login: "acme" },
    name: "repo",
    html_url: repositoryUrl,
  },
  pull_request: {
    number: 109,
    title,
    body,
    head: { ref: branch },
    html_url: `${repositoryUrl}/pull/109`,
    state: "open",
    draft: false,
    merged: false,
    user: { login: "octocat" },
  },
});

describe("github pull request task identity", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;
  let deps: GitHubDeps;
  let publish: MockInstance<EventBus["publish"]>;
  let pulls: PullRequest[] = [];
  let fixture: Awaited<ReturnType<typeof createFixture>>;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
    deps = githubDepsOf(app);
  });
  afterAll(() => app.close());

  async function createFixture(slug = "KAN", repo = "repo") {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug,
    });
    const integration = await insertGitHubIntegration(app.db, project.id, {
      repositoryOwner: "acme",
      repositoryName: repo,
      installationId: 1,
      repositoryId: repo === "repo" ? 2 : 3,
      verifiedGithubAccountId: "4",
      verifiedByUserId: member.user.id,
      branchPattern: "{slug}-{number}",
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

  // The pull requests the import's GraphQL pages answer.
  function servePulls() {
    double.octokit.graphql.mockImplementation(async (query: string) =>
      query.includes("query ImportIssues(")
        ? issuePage([])
        : pullsPage(
            pulls.map((pull) => ({
              number: pull.number,
              title: pull.title,
              body: pull.body,
              url: pull.html_url,
              state: pull.state.toUpperCase(),
              headRefName: pull.head.ref,
              createdAt: OLD_GITHUB_DATE,
              author: null,
            })),
          ),
    );
  }
  const runImport = async () => {
    const imports = app.get(GitHubImportService);
    let result = await imports.importIssues(fixture.project.id);
    for (let attempt = 0; result.pending && attempt < 10; attempt++) {
      result = await imports.importIssues(fixture.project.id, result.runId);
    }
    expect(result.pending).toBe(false);
  };
  const open = (event = payload()) => handlePullRequestOpened(deps, event);
  const openUnscoped = open;
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
    double.reset();
    // Event delivery is not under test; keep subscribers from running after
    // the next test has reset the database.
    publish = vi
      .spyOn(app.get(EventBus), "publish")
      .mockResolvedValue(undefined);
    fixture = await createFixture();
    pulls = [payload().pull_request];
    servePulls();
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
    await handlePullRequestClosed(deps, {
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
    pulls = [payload("KAN-42: Fix copy", "").pull_request];
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
    const push = (after?: string) => {
      const { installation, repository } = payload();
      return handlePush(deps, {
        after,
        ref: `refs/heads/${branch}`,
        installation,
        repository,
      });
    };
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
      const { installation, repository } = payload();
      await handlePush(deps, {
        ref: "refs/tags/kan-42",
        installation,
        repository,
      });
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
});

// The Gitea/GitLab cases are in test/integration/gitea-pull-request-task-links.test.ts.
