// Ported from tests/api-integration/integration-sync-settings.test.ts. The
// previous suite covered only Gitea and GitLab (ported in gitea-*.test.ts); the GitHub
// case checks the same contract for `PATCH /api/github-integration/project/:id`,
// which also writes only when the stored config is unchanged.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { validateGitHubConfig } from "../../src/integrations/github/config/github-config";
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
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The previous suite spied on the config module's validator; here the real
// validator is wrapped so the test can hold the PATCH open after it read.
vi.mock(
  "../../src/integrations/github/config/github-config",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/integrations/github/config/github-config")
      >();
    return {
      ...actual,
      validateGitHubConfig: vi.fn(actual.validateGitHubConfig),
    };
  },
);

describe("GitHub settings and saved sync rules", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    double.reset();
    vi.mocked(validateGitHubConfig).mockClear();
    vi.spyOn(app.get(EventBus), "publish").mockResolvedValue(undefined);
  });

  // The Gitea/GitLab cases are in test/integration/gitea-sync-settings.test.ts.

  it("github settings cannot overwrite rules saved during validation", async () => {
    const member = await createWorkspaceMember(app.db, { role: "owner" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    const integration = await insertGitHubIntegration(
      app.db,
      project.id,
      verifiedGitHubConfig({ syncRules: defaultSyncRules }),
    );
    app.auth.signIn(member.user);
    const property = "commentTaskLinkOnGitHubIssue";
    const patch = () =>
      app.request(`/api/github-integration/project/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [property]: false }),
      });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const validation = vi.mocked(validateGitHubConfig);
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
        await getSyncIntegration(app.db, project.id, "github"),
        rules,
      );
      await app
        .get(SyncRulesService)
        .saveRules(
          project.id,
          "github",
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
        (
          await app.db.findOneOrFail(IntegrationEntity, {
            where: { id: integration.id },
          })
        ).config,
      );
    expect((await readConfig()).syncRules).toEqual(rules);
    expect((await patch()).status).toBe(200);
    expect(await readConfig()).toMatchObject({
      syncRules: rules,
      [property]: false,
    });
  });
});
