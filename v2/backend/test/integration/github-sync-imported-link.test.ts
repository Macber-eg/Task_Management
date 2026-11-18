// Ported from tests/api-integration/integration-sync-imported-link.test.ts
// (GitHub cases; the Gitea/GitLab ones are listed as skipped).
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
import { LabelEntity } from "../../src/database/entities/label.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { handleIssueOpened } from "../../src/integrations/github/webhooks/issue-opened";
import { canSyncTask } from "../../src/integrations/sync/eligibility";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GitHub imported issue links", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    double.reset();
    double.octokit.rest.issues.createComment.mockResolvedValue(undefined);
    vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
  });

  // The Gitea/GitLab cases are in test/integration/gitea-sync-imported-link.test.ts and gitlab-sync-imported-link.test.ts.

  it.each([true, false])(
    "github webhook imports links with their committed outgoing scope (qualifying=%s)",
    async (qualifying) => {
      const { workspace, user } = await createWorkspaceMember(app.db);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });
      const label = await insertRow(app.db, LabelEntity, {
        workspaceId: workspace.id,
        name: "export",
        color: "red",
      });
      const integration = await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "github",
        isActive: true,
        config: JSON.stringify({
          repositoryOwner: "team",
          repositoryName: "repo",
          repositoryId: 1,
          installationId: 2,
          verifiedGithubAccountId: "3",
          verifiedByUserId: user.id,
          baseUrl: "https://git.example",
          projectPath: "team/repo",
          accessToken: "fake-test-token",
          commentTaskLinkOnGitHubIssue: false,
          commentTaskLinkOnGiteaIssue: false,
          commentTaskLinkOnGitlabIssue: false,
          syncRules: {
            outgoing: { mode: "labels", match: "any", labels: [label.id] },
            incoming: { mode: "all" },
          },
        }),
      });
      const labels = qualifying ? ["export"] : ["other"];
      const issue = {
        number: 9,
        title: "Imported issue",
        body: "Body",
        html_url: "https://git.example/team/repo/issues/9",
        labels: labels.map((name) => ({ name, color: "1a2b3c" })),
        user: { login: "author" },
      };
      const repository = {
        id: 1,
        owner: { login: "team" },
        name: "repo",
        full_name: "team/repo",
        html_url: "https://git.example/team/repo",
      };
      await handleIssueOpened(
        githubDepsOf(app),
        { action: "opened", installation: { id: 2 }, issue, repository },
        integration.id,
      );
      const [link] = await app.db.find(ExternalLinkEntity);
      expect(link).toBeDefined();
      expect(JSON.parse(link!.metadata!).syncFilterPaused === true).toBe(
        !qualifying,
      );
      const assigned = await app.db.findOne(LabelEntity, {
        where: { taskId: link!.taskId },
      });
      expect(assigned?.color).toBe(qualifying ? label.color : "#1a2b3c");
      if (!qualifying) {
        await insertRow(app.db, LabelEntity, {
          taskId: link!.taskId,
          workspaceId: workspace.id,
          name: label.name,
          color: label.color,
        });
        expect(await canSyncTask(app.db, link!.taskId, integration.id)).toBe(
          false,
        );
        expect(
          await app.db.findOne(ExternalLinkEntity, { where: { id: link!.id } }),
        ).toMatchObject({ id: link!.id, integrationId: integration.id });
      }
    },
  );

  // The Gitea/GitLab cases are in test/integration/gitea-sync-imported-link.test.ts and gitlab-sync-imported-link.test.ts.
});
