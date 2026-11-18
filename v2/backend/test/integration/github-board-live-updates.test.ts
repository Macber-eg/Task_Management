// Ported from tests/api-integration/provider-board-live-updates.test.ts (GitHub cases).
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { handleIssueEdited } from "../../src/integrations/github/webhooks/issue-edited";
import { handleIssueLabeled } from "../../src/integrations/github/webhooks/issue-labeled";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import {
  githubWebhookSource,
  insertGitHubIntegration,
} from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { createTestApp, type TestApp } from "../support/test-app";

const double = createGitHubAppDouble();
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
  vi.restoreAllMocks();
});

it.each(["text", "priority", "label", "label-delete"])(
  "announces committed github %s edits to observing boards",
  async (kind) => {
    const { workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      number: 1,
      title: "Before",
      description: "Before body",
      priority: "low",
    });
    const integration = await insertGitHubIntegration(app.db, project.id);
    await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://provider.example/issues/1",
      metadata: "{}",
    });
    if (kind === "label-delete")
      await insertRow(app.db, LabelEntity, {
        taskId: task.id,
        workspaceId: workspace.id,
        name: "bug",
        color: "#ff0000",
      });
    const publish = vi
      .spyOn(app.get(EventBus), "publish")
      .mockImplementation(async () => {
        const committed = await app.db.findOneByOrFail(TaskEntity, {
          id: task.id,
        });
        if (kind === "text") {
          expect(committed.title).toBe("After");
          expect(committed.description).toBe("After body");
        } else if (kind === "priority") expect(committed.priority).toBe("high");
        else {
          const labels = await app.db.findBy(LabelEntity, { taskId: task.id });
          expect(labels.map((label) => label.name)).toEqual(
            kind === "label-delete" ? [] : ["bug"],
          );
        }
      });
    const issue = {
      number: 1,
      title: "After",
      body: "After body",
      html_url: "https://github.com/owner/repo/issues/1",
    };
    if (kind === "text") {
      await handleIssueEdited(deps, {
        action: "edited",
        issue,
        ...githubWebhookSource,
        changes: { title: { from: "Before" }, body: { from: "Before body" } },
      });
    } else {
      const label = {
        name: kind === "priority" ? "priority:high" : "bug",
        color: "ff0000",
      };
      await handleIssueLabeled(deps, {
        action: kind === "label-delete" ? "unlabeled" : "labeled",
        issue: { ...issue, labels: kind === "label-delete" ? [] : [label] },
        label,
        ...githubWebhookSource,
      });
    }
    const saved = await app.db.findOneByOrFail(TaskEntity, { id: task.id });
    if (kind === "text") {
      expect(saved.title).toBe("After");
      expect(saved.description).toBe("After body");
    } else if (kind === "priority") expect(saved.priority).toBe("high");
    else {
      const labels = await app.db.findBy(LabelEntity, { taskId: task.id });
      expect(labels.map((label) => label.name)).toEqual(
        kind === "label-delete" ? [] : ["bug"],
      );
    }
    expect(publish.mock.calls).toEqual([
      [
        kind === "text" || kind === "priority"
          ? "task.updated"
          : "task.labels_updated",
        {
          projectId: project.id,
          taskId: task.id,
          ...(kind === "text" ? { titleChanged: true } : {}),
        },
      ],
    ]);
  },
);

// The Gitea/GitLab cases are in test/integration/gitea-board-live-updates.test.ts.
