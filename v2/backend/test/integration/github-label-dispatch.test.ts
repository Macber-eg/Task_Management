// Ported from tests/api-integration/integration-label-dispatch.test.ts (GitHub
// cases; the Gitea/GitLab ones are in gitea-label-dispatch.test.ts).
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
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { githubIssueAccess } from "../../src/integrations/github/issues/github-issue-access";
import {
  removeLabelFromGitHub,
  syncLabelToGitHub,
} from "../../src/integrations/github/labels/github-label-sync";
import { addLabelsToIssue } from "../../src/integrations/github/labels/github-labels";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import { initializeTaskIssue } from "../../src/integrations/sync/initialize-task-issue";
import { syncTaskFieldLabels } from "../../src/integrations/sync/sync-task-field-labels";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite spied on the module export; here the real function is
// wrapped so a test can hold the first eligibility check open.
vi.mock("../../src/integrations/sync/eligibility", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/integrations/sync/eligibility")>();
  return { ...actual, canSyncTask: vi.fn(actual.canSyncTask) };
});

describe("GitHub label dispatch", () => {
  const double = createGitHubAppDouble();
  const { octokit } = double;
  const lookup = vi.fn();
  let app: TestApp;
  let deps: GitHubDeps;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
    deps = githubDepsOf(app);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    double.reset();
    lookup.mockReset().mockResolvedValue(undefined);
    octokit.rest.repos.get.mockResolvedValue({ data: { id: 1 } });
    octokit.rest.issues.get.mockResolvedValue({
      data: { title: "Label race", body: "", state: "open", labels: [] },
    });
    octokit.rest.issues.getLabel.mockImplementation(async () => {
      await lookup();
      throw new Error("Label does not exist");
    });
    octokit.rest.issues.createLabel.mockResolvedValue({ id: 7, name: "bug" });
    octokit.rest.issues.addLabels.mockResolvedValue(undefined);
    octokit.rest.issues.removeLabel.mockResolvedValue(undefined);
  });

  async function fixture() {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const config = {
      repositoryOwner: "team",
      repositoryName: "repo",
      repositoryId: 1,
      installationId: 2,
      verifiedGithubAccountId: "3",
      verifiedByUserId: user.id,
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "github",
      isActive: true,
      config: JSON.stringify(config),
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Label race",
      number: 1,
      status: "to-do",
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "12",
      url: "https://git.example/team/repo/issues/12",
    });
    return { project, config, integration, task, link };
  }
  const readMetadata = async (id: string) =>
    JSON.parse(
      (await app.db.findOneOrFail(ExternalLinkEntity, { where: { id } }))
        .metadata!,
    ) as Record<string, unknown>;

  it("github initialization does not create labels after a pause during label lookup", async () => {
    const f = await fixture();
    await updateExternalLink(app.db, f.link.id, {
      metadata: {
        syncInitializationPending: true,
        syncInitializedState: true,
        syncCreatedText: { title: f.task.title, description: "" },
      },
    });
    const link = await app.db.findOneOrFail(ExternalLinkEntity, {
      where: { id: f.link.id },
    });
    const client = await deps.github.verifiedInstallationOctokit(
      f.config as never,
    );
    let started!: () => void;
    let release!: () => void;
    const listed = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    lookup.mockImplementationOnce(async () => {
      started();
      await gate;
    });
    const context = {
      integrationId: f.integration.id,
      projectId: f.project.id,
      config: f.config,
    };
    const initializing = initializeTaskIssue(
      app.db,
      deps.events,
      {
        taskId: f.task.id,
        projectId: f.project.id,
        userId: "",
        title: f.task.title,
        description: null,
        priority: "low",
        status: "to-do",
        number: 1,
      },
      context,
      link,
      {
        text: async () => undefined,
        state: async () => {
          await octokit.rest.issues.addLabels();
          return undefined;
        },
        labels: async () =>
          syncTaskFieldLabels(
            app.db,
            await githubIssueAccess(
              deps.github,
              { config: JSON.stringify(f.config) },
              { externalId: "12", taskId: f.task.id },
            ),
            f.task.id,
            context,
            f.link,
            "initialization",
            ({ add: names }, write) =>
              addLabelsToIssue(client, "team", "repo", 12, names, true, write),
          ),
      },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await listed;
      await updateExternalLink(app.db, f.link.id, {
        metadata: { syncFilterPaused: true },
      });
    } finally {
      release();
    }
    expect(await initializing).toBeInstanceOf(Error);
    expect(octokit.rest.issues.createLabel).not.toHaveBeenCalled();
    expect(octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(await readMetadata(f.link.id)).toMatchObject({
      syncInitializationPending: true,
      syncFilterPaused: true,
    });
  });

  // The Gitea/GitLab cases are in test/integration/gitea-label-dispatch.test.ts.

  const cases = (["add", "remove"] as const).flatMap((action) =>
    (["unchanged", "paused", "rule_changed"] as const).map((change) => ({
      action,
      change,
    })),
  );

  it.each(cases)(
    "github custom-label $action rechecks scope at dispatch ($change)",
    async ({ action, change }) => {
      const { config, integration, task, link } = await fixture();
      let started!: () => void;
      let release!: () => void;
      const checked = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const guard = vi.mocked(canSyncTask);
      const original = guard.getMockImplementation()!;
      guard.mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        expect(result).toBe(true);
        started();
        await gate;
        return result;
      });
      const writing =
        action === "add"
          ? syncLabelToGitHub(deps, task.id, "bug", "#123456")
          : removeLabelFromGitHub(deps, task.id, "bug");
      try {
        await checked;
        if (change === "paused")
          await updateExternalLink(app.db, link.id, {
            metadata: { syncFilterPaused: true },
          });
        if (change === "rule_changed")
          await app.db.update(
            IntegrationEntity,
            { id: integration.id },
            {
              config: JSON.stringify({
                ...config,
                syncRules: {
                  outgoing: {
                    mode: "labels",
                    match: "any",
                    labels: ["missing"],
                  },
                  incoming: { mode: "all" },
                },
              }),
            },
          );
      } finally {
        release();
        await writing;
      }
      expect(octokit.rest.issues.addLabels).toHaveBeenCalledTimes(
        change === "unchanged" && action === "add" ? 1 : 0,
      );
      expect(octokit.rest.issues.removeLabel).toHaveBeenCalledTimes(
        change === "unchanged" && action === "remove" ? 1 : 0,
      );
      if (change !== "unchanged")
        expect(octokit.rest.issues.createLabel).not.toHaveBeenCalled();
    },
  );

  // The Gitea/GitLab cases are in test/integration/gitea-label-dispatch.test.ts.
});
