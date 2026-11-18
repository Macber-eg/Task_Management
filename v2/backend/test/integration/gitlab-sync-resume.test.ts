import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { handleGitlabIssueReopened } from "../../src/integrations/gitlab/webhooks/issue-state";
import { ProviderIssues } from "../../src/integrations/sync/provider-issues";
import { SyncResumeReviewService } from "../../src/integrations/sync-routes/sync-resume-review.service";
import { SyncResumeService } from "../../src/integrations/sync-routes/sync-resume.service";
import {
  createProviderIssueDouble,
  setupSyncFixture,
} from "../support/fixtures/integrations-sync-fixture";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The GitLab half of "preserves a GitLab task's chosen column through its
// reopen echo" from tests/api-integration/integration-sync-rules.test.ts
// (its resume half is in integrations-sync-resume.test.ts).
describe("GitLab sync resume", () => {
  const double = createProviderIssueDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({
      overrides: [[ProviderIssues, double.issues]],
    });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    double.reset();
  });

  it("preserves a GitLab task's chosen column through its reopen echo", async () => {
    const f = await setupSyncFixture(app);
    await f.assign();
    await f.setRules();
    const pausedLink = await f.link(true);
    await app.db.update(
      IntegrationEntity,
      { id: f.integration.id },
      {
        type: "gitlab",
        config: JSON.stringify({
          baseUrl: "https://git.example",
          accessToken: "test-only",
          projectPath: "team/repo",
          syncRules: f.rules,
        }),
      },
    );
    await app.db.update(
      TaskEntity,
      { id: f.task.id },
      { status: f.columns.inProgress.slug, columnId: f.columns.inProgress.id },
    );
    const review = await app
      .get(SyncResumeReviewService)
      .review(f.project.id, "gitlab", pausedLink.id, f.workspace.id);
    await app
      .get(SyncResumeService)
      .resumeSync(
        f.project.id,
        "gitlab",
        pausedLink.id,
        review.token,
        "kaneo",
        f.workspace.id,
      );
    const link = await app.db.findOne(ExternalLinkEntity, {
      where: { id: pausedLink.id },
    });
    expect(JSON.parse(link!.metadata!)).toMatchObject({ state: "opened" });

    await handleGitlabIssueReopened(
      app.db,
      app.get(EventBus),
      {
        object_attributes: {
          iid: 9,
          title: "Kaneo title",
          url: link!.url,
          state: "opened",
          action: "reopen",
          updated_at: new Date().toISOString(),
        },
        project: {
          name: "repo",
          path_with_namespace: "team/repo",
          web_url: "https://git.example/team/repo",
        },
      },
      f.integration.id,
    );

    expect(
      await app.db.findOne(TaskEntity, { where: { id: f.task.id } }),
    ).toMatchObject({
      status: f.columns.inProgress.slug,
      columnId: f.columns.inProgress.id,
    });
  });
});
