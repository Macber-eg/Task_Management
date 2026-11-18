// Ported from tests/api-integration/github-import-status.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ColumnEntity } from "../../src/database/entities/column.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { GitHubImportService } from "../../src/integrations/github/import/github-import.service";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertGitHubIntegration } from "../support/fixtures/github-fixtures";
import {
  connection,
  emptyPulls,
  importGitHubConfig,
  importedIssue,
  issuePage,
} from "../support/fixtures/github-import-pages";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GitHub import project workflow validation", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;
  let labels: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    double.reset();
    labels = [];
    double.octokit.graphql.mockImplementation(async (query: string) =>
      query.includes("query ImportIssues(")
        ? issuePage(
            [
              importedIssue(1, {
                title: "Imported",
                labels: connection(
                  labels.map((name) => ({ name, color: "ffffff" })),
                ),
              }),
            ],
            false,
            "issue-1",
          )
        : emptyPulls(),
    );
  });

  async function setup() {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const integration = await insertGitHubIntegration(
      app.db,
      project.id,
      importGitHubConfig(user.id),
    );
    return { project, columns, integration, workspace };
  }
  const importIssues = (projectId: string) =>
    app.get(GitHubImportService).importIssues(projectId);
  const storedTask = async () => (await app.db.find(TaskEntity))[0];

  it("maps arbitrary external statuses to a real local column for new tasks", async () => {
    const { project, columns } = await setup();
    labels = ["status:hidden"];
    expect(await importIssues(project.id)).toMatchObject({ imported: 1 });
    expect(await storedTask()).toMatchObject({
      status: "to-do",
      columnId: columns.todo.id,
    });
  });

  it("preserves an existing valid status when reimport has an unknown label", async () => {
    const { project, columns } = await setup();
    labels = ["status:in-progress"];
    await importIssues(project.id);
    labels = ["status:hidden"];
    expect(await importIssues(project.id)).toMatchObject({ updated: 1 });
    expect(await storedTask()).toMatchObject({
      status: "in-progress",
      columnId: columns.inProgress.id,
    });
  });

  it("uses custom columns belonging to the imported project and updates columnId together", async () => {
    const { project, columns } = await setup();
    await app.db.update(
      ColumnEntity,
      { id: columns.todo.id },
      { slug: "ready", name: "Ready" },
    );
    labels = ["status:hidden"];
    await importIssues(project.id);
    expect(await storedTask()).toMatchObject({
      status: "ready",
      columnId: columns.todo.id,
    });
    labels = ["status:in-review"];
    await importIssues(project.id);
    expect(await storedTask()).toMatchObject({
      status: "in-review",
      columnId: columns.inReview.id,
    });
  });

  it.each(["planned", "archived"])(
    "allows virtual status %s and clears the old column",
    async (status) => {
      const { project } = await setup();
      await importIssues(project.id);
      labels = [`status:${status}`];
      await importIssues(project.id);
      expect(await storedTask()).toMatchObject({ status, columnId: null });
    },
  );

  it("uses planned without workflow columns and repairs an invalid legacy status on reimport", async () => {
    const { project } = await setup();
    await app.db.delete(ColumnEntity, { projectId: project.id });
    await importIssues(project.id);
    expect(await storedTask()).toMatchObject({
      status: "planned",
      columnId: null,
    });
    const task = await storedTask();
    if (!task) throw new Error("Expected imported task");
    await app.db.update(TaskEntity, { id: task.id }, { status: "hidden" });
    labels = ["status:hidden"];
    await importIssues(project.id);
    expect(await storedTask()).toMatchObject({
      status: "planned",
      columnId: null,
    });
  });

  it("does not mutate another project's task through a legacy external link", async () => {
    const { project, integration, workspace } = await setup();
    const { project: other } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: other.id,
      title: "Untouched",
      number: 1,
    });
    await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://github.com/example/repo/issues/1",
    });
    labels = ["status:archived"];
    expect(await importIssues(project.id)).toMatchObject({
      imported: 0,
      updated: 0,
      skipped: 1,
    });
    expect(await storedTask()).toMatchObject({
      title: "Untouched",
      status: "to-do",
    });
  });
});
