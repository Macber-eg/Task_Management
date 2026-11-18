// The Gitea and GitLab cases of
// tests/api-integration/integration-label-dispatch.test.ts (the GitHub cases
// are in github-label-dispatch.test.ts).
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
import { EventBus } from "../../src/events/event-bus";
import type { GiteaConfig } from "../../src/integrations/gitea/config";
import { giteaIssueAccess } from "../../src/integrations/gitea/gitea-issue-access";
import { addLabelsToIssueGitea } from "../../src/integrations/gitea/labels/gitea-issue-labels";
import {
  removeLabelFromGitea,
  syncLabelToGitea,
} from "../../src/integrations/gitea/labels/sync-label-to-gitea";
import type { GitlabConfig } from "../../src/integrations/gitlab/config";
import { gitlabIssueAccess } from "../../src/integrations/gitlab/gitlab-issue-access";
import { updateIssueLabelsGitlab } from "../../src/integrations/gitlab/labels/issue-labels";
import {
  removeLabelFromGitlab,
  syncLabelToGitlab,
} from "../../src/integrations/gitlab/labels/sync-label-to-gitlab";
import { updateExternalLink } from "../../src/integrations/links/external-link-writes";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import { initializeTaskIssue } from "../../src/integrations/sync/initialize-task-issue";
import { syncTaskFieldLabels } from "../../src/integrations/sync/sync-task-field-labels";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
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

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  createLabel: vi.fn(),
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
}));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => ({
    listLabels: async () => {
      await mocks.lookup();
      return [{ id: 7, name: "bug" }];
    },
    getIssue: async () => ({ labels: [] }),
    createLabel: mocks.createLabel,
    addLabelsToIssue: mocks.addLabel,
    removeLabelFromIssue: mocks.removeLabel,
  }),
}));
vi.mock("../../src/integrations/gitlab/client/gitlab-client", () => ({
  createGitlabClient: () => ({
    listLabels: async () => {
      await mocks.lookup();
      return [];
    },
    getIssue: async () => ({ labels: [] }),
    createLabel: mocks.createLabel,
    updateIssue: async (
      _project: string,
      _issue: number,
      change: { add_labels?: string },
    ) => (change.add_labels ? mocks.addLabel : mocks.removeLabel)(),
  }),
}));

type Provider = "gitea" | "gitlab";

describe("Gitea and GitLab label dispatch", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.mocked(canSyncTask).mockClear();
    mocks.lookup.mockReset().mockResolvedValue(undefined);
    mocks.createLabel.mockReset().mockResolvedValue({ id: 7, name: "bug" });
    mocks.addLabel.mockReset().mockResolvedValue(undefined);
    mocks.removeLabel.mockReset().mockResolvedValue(undefined);
  });

  async function fixture(provider: Provider) {
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
      baseUrl: "https://git.example",
      projectPath: "team/repo",
      accessToken: "fake-test-token",
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: provider,
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

  it.each(["gitea", "gitlab"] as const)(
    "%s initialization does not create labels after a pause during label lookup",
    async (provider) => {
      const f = await fixture(provider);
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
      let started!: () => void;
      let release!: () => void;
      const listed = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.lookup.mockImplementationOnce(async () => {
        started();
        await gate;
      });
      const context = {
        integrationId: f.integration.id,
        projectId: f.project.id,
        config: f.config,
      };
      const raw = JSON.stringify(f.config);
      const issue = { externalId: "12", taskId: f.task.id };
      const initializing = initializeTaskIssue(
        app.db,
        app.get(EventBus),
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
            await mocks.addLabel();
            return undefined;
          },
          labels: () =>
            syncTaskFieldLabels(
              app.db,
              provider === "gitea"
                ? giteaIssueAccess(raw, issue)
                : gitlabIssueAccess(raw, issue),
              f.task.id,
              context,
              f.link,
              "initialization",
              ({ add: names }, write) =>
                provider === "gitea"
                  ? addLabelsToIssueGitea(
                      f.config as unknown as GiteaConfig,
                      12,
                      names,
                      true,
                      write,
                    )
                  : updateIssueLabelsGitlab(
                      f.config as unknown as GitlabConfig,
                      12,
                      { add: names },
                      true,
                      write,
                    ),
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
      expect(mocks.createLabel).not.toHaveBeenCalled();
      expect(mocks.addLabel).not.toHaveBeenCalled();
      expect(await readMetadata(f.link.id)).toMatchObject({
        syncInitializationPending: true,
        syncFilterPaused: true,
      });
    },
  );

  const cases = (["gitea", "gitlab"] as const).flatMap((provider) =>
    (["add", "remove"] as const).flatMap((action) =>
      (["unchanged", "paused", "rule_changed"] as const).map((change) => ({
        provider,
        action,
        change,
      })),
    ),
  );

  it.each(cases)(
    "$provider custom-label $action rechecks scope at dispatch ($change)",
    async ({ provider, action, change }) => {
      const { config, integration, task, link } = await fixture(provider);
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
      const methods = {
        gitea: {
          add: () => syncLabelToGitea(app.db, task.id, "bug", "#123456"),
          remove: () => removeLabelFromGitea(app.db, task.id, "bug"),
        },
        gitlab: {
          add: () => syncLabelToGitlab(app.db, task.id, "bug", "#123456"),
          remove: () => removeLabelFromGitlab(app.db, task.id, "bug"),
        },
      };
      const writing = methods[provider][action]();
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
      expect(mocks.addLabel).toHaveBeenCalledTimes(
        change === "unchanged" && action === "add" ? 1 : 0,
      );
      expect(mocks.removeLabel).toHaveBeenCalledTimes(
        change === "unchanged" && action === "remove" ? 1 : 0,
      );
      if (change !== "unchanged")
        expect(mocks.createLabel).not.toHaveBeenCalled();
    },
  );
});
