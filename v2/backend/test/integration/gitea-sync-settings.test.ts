// The Gitea and GitLab cases of tests/api-integration/integration-sync-settings.test.ts.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { EventBus } from "../../src/events/event-bus";
import { validateGiteaConfig } from "../../src/integrations/gitea/config";
import { validateGitlabConfig } from "../../src/integrations/gitlab/config";
import { defaultSyncRules, type SyncRules } from "../../src/integrations/sync/rules";
import { getSyncIntegration } from "../../src/integrations/sync-routes/get-sync-integration";
import { previewSyncRules } from "../../src/integrations/sync-routes/preview-sync-rules";
import { SyncRulesService } from "../../src/integrations/sync-routes/sync-rules.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite spied on the config modules' validators; here the real
// validators are wrapped so the test can hold the PATCH open after it read.
vi.mock("../../src/integrations/gitea/config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/integrations/gitea/config")>();
  return { ...actual, validateGiteaConfig: vi.fn(actual.validateGiteaConfig) };
});
vi.mock("../../src/integrations/gitlab/config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/integrations/gitlab/config")>();
  return {
    ...actual,
    validateGitlabConfig: vi.fn(actual.validateGitlabConfig),
  };
});

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.mocked(validateGiteaConfig).mockClear();
  vi.mocked(validateGitlabConfig).mockClear();
  vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
});

it.each(["gitea", "gitlab"] as const)(
  "%s settings cannot overwrite rules saved during validation",
  async (type) => {
    const member = await createWorkspaceMember(app.db, { role: "owner" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type,
      isActive: true,
      config: JSON.stringify({
        baseUrl: "https://git.example",
        accessToken: "test-only",
        repositoryOwner: "team",
        repositoryName: "repo",
        projectPath: "team/repo",
        syncRules: defaultSyncRules,
      }),
    });
    app.auth.signIn(member.user);
    const property =
      type === "gitea"
        ? "commentTaskLinkOnGiteaIssue"
        : "commentTaskLinkOnGitlabIssue";
    const patch = () =>
      app.request(`/api/${type}-integration/project/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [property]: false }),
      });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const validation = vi.mocked(
      type === "gitea" ? validateGiteaConfig : validateGitlabConfig,
    );
    validation.mockImplementationOnce(async () => {
      await gate;
      return { valid: true };
    });
    const pending = patch();
    const rules: SyncRules = {
      ...defaultSyncRules,
      incoming: { mode: "labels", match: "all", labels: ["ready"] },
    };
    try {
      await vi.waitFor(() => expect(validation).toHaveBeenCalledOnce());
      const preview = await previewSyncRules(
        app.db,
        await getSyncIntegration(app.db, project.id, type),
        rules,
      );
      await app
        .get(SyncRulesService)
        .saveRules(
          project.id,
          type,
          rules,
          preview.previewToken,
          member.workspace.id,
        );
    } finally {
      release();
    }
    expect((await pending).status).toBe(409);
    const readConfig = async () =>
      JSON.parse(
        (await app.db.findOneByOrFail(IntegrationEntity, { id: integration.id }))
          .config,
      );
    expect((await readConfig()).syncRules).toEqual(rules);
    expect((await patch()).status).toBe(200);
    expect(await readConfig()).toMatchObject({
      syncRules: rules,
      [property]: false,
    });
  },
);
