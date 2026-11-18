// The Gitea and GitLab cases of tests/api-integration/integration-sync-reconnect.test.ts.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { EventBus } from "../../src/events/event-bus";
import { GiteaIntegrationService } from "../../src/integrations/gitea/integration/gitea-integration.service";
import { GitlabIntegrationService } from "../../src/integrations/gitlab/integration/gitlab-integration.service";
import { defaultSyncRules, type SyncRules } from "../../src/integrations/sync/rules";
import { getSyncIntegration } from "../../src/integrations/sync-routes/get-sync-integration";
import { previewSyncRules } from "../../src/integrations/sync-routes/preview-sync-rules";
import { SyncRulesService } from "../../src/integrations/sync-routes/sync-rules.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const verify = vi.hoisted(() => vi.fn());
vi.mock("../../src/integrations/gitea/client/verify-gitea-token", () => ({
  verifyGiteaToken: verify,
}));
vi.mock("../../src/integrations/gitea/client/gitea-client", () => ({
  createGiteaClient: () => ({ getRepo: async () => ({}) }),
}));
vi.mock("../../src/integrations/gitlab/client/verify-gitlab-token", () => ({
  verifyGitlabToken: verify,
}));
vi.mock("../../src/integrations/gitlab/client/gitlab-client", () => ({
  createGitlabClient: () => ({ getProject: async () => ({}) }),
}));

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
  verify.mockReset().mockResolvedValue({ id: 1 });
  vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});

it.each(["gitea", "gitlab"] as const)(
  "%s reconnect cannot overwrite rules saved during verification",
  async (type) => {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const base = {
      baseUrl: "https://git.example",
      accessToken: "test-only",
      webhookSecret: "test-hook",
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type,
      isActive: true,
      config: JSON.stringify({
        ...base,
        repositoryOwner: "team",
        repositoryName: "repo",
        projectPath: "team/repo",
        syncRules: defaultSyncRules,
      }),
    });
    const reconnect = () =>
      type === "gitea"
        ? app.get(GiteaIntegrationService).create({
            baseUrl: base.baseUrl,
            accessToken: base.accessToken,
            projectId: project.id,
            repositoryOwner: "team",
            repositoryName: "repo",
          })
        : app.get(GitlabIntegrationService).create({
            baseUrl: base.baseUrl,
            accessToken: base.accessToken,
            projectId: project.id,
            tokenType: "private",
            projectPath: "team/repo",
          });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    verify.mockImplementationOnce(async () => {
      await gate;
      return { id: 1 };
    });
    const pending = reconnect();
    const conflict = expect(pending).rejects.toMatchObject({ status: 409 });
    const rules: SyncRules = {
      ...defaultSyncRules,
      incoming: { mode: "labels", match: "all", labels: ["ready"] },
    };
    try {
      await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());
      const preview = await previewSyncRules(
        app.db,
        await getSyncIntegration(app.db, project.id, type),
        rules,
      );
      await app
        .get(SyncRulesService)
        .saveRules(project.id, type, rules, preview.previewToken, workspace.id);
    } finally {
      release();
      await conflict;
    }
    const readRules = async () =>
      JSON.parse(
        (await app.db.findOneByOrFail(IntegrationEntity, { id: integration.id }))
          .config,
      ).syncRules;
    expect(await readRules()).toEqual(rules);
    await reconnect();
    expect(await readRules()).toEqual(rules);
  },
);
