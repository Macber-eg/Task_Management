// Ported from tests/api-integration/integration-sync-reconnect.test.ts. The
// previous suite covered only Gitea and GitLab (ported in gitea-*.test.ts); the GitHub
// case checks the same guarantee for `POST /api/github-integration/project/:id`.
// GitHub verifies the repository before it reads the stored binding (as the
// previous backend did), so a save during verification is merged rather than
// rejected with 409; the saved rules must survive either way.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { defaultSyncRules, type SyncRules } from "../../src/integrations/sync/rules";
import { getSyncIntegration } from "../../src/integrations/sync-routes/get-sync-integration";
import { previewSyncRules } from "../../src/integrations/sync-routes/preview-sync-rules";
import { SyncRulesService } from "../../src/integrations/sync-routes/sync-rules.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import {
  insertGitHubIntegration,
  verifiedGitHubConfig,
} from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GitHub reconnect and saved sync rules", () => {
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
    vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
    double.app.octokit.rest.apps.getRepoInstallation.mockResolvedValue({
      data: { id: 10 },
    });
    double.octokit.rest.users.getById.mockResolvedValue({
      data: { id: 30, login: "admin" },
    });
    double.octokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue(
      { data: { permission: "admin" } },
    );
    double.octokit.rest.repos.get.mockResolvedValue({
      data: { id: 20, owner: { login: "owner" }, name: "repo" },
    });
  });

  // The Gitea/GitLab cases are in test/integration/gitea-sync-reconnect.test.ts.

  it("github reconnect cannot overwrite rules saved during verification", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db, {
      role: "owner",
    });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    await insertRow(app.db, AccountEntity, {
      id: `account-${user.id}`,
      userId: user.id,
      providerId: "github",
      accountId: "30",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const integration = await insertGitHubIntegration(
      app.db,
      project.id,
      verifiedGitHubConfig({
        verifiedByUserId: user.id,
        syncRules: defaultSyncRules,
      }),
    );
    app.auth.signIn(user);
    const reconnect = () =>
      app.request(`/api/github-integration/project/${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryOwner: "owner", repositoryName: "repo" }),
      });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verify = double.app.octokit.rest.apps.getRepoInstallation;
    verify.mockImplementationOnce(async () => {
      await gate;
      return { data: { id: 10 } };
    });
    const pending = reconnect();
    const rules: SyncRules = {
      ...defaultSyncRules,
      incoming: { mode: "labels", match: "all", labels: ["ready"] },
    };
    try {
      await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());
      const preview = await previewSyncRules(
        app.db,
        await getSyncIntegration(app.db, project.id, "github"),
        rules,
      );
      await app
        .get(SyncRulesService)
        .saveRules(project.id, "github", rules, preview.previewToken, workspace.id);
    } finally {
      release();
    }
    expect((await pending).status).toBe(200);
    const readRules = async () =>
      JSON.parse(
        (
          await app.db.findOneOrFail(IntegrationEntity, {
            where: { id: integration.id },
          })
        ).config,
      ).syncRules;
    expect(await readRules()).toEqual(rules);
    expect((await reconnect()).status).toBe(200);
    expect(await readRules()).toEqual(rules);
  });
});
