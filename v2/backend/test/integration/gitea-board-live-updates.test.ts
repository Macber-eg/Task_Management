// The Gitea and GitLab cases of
// tests/api-integration/provider-board-live-updates.test.ts: an inbound edit
// publishes exactly one board event, after its write committed.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { handleGiteaIssueEdited } from "../../src/integrations/gitea/webhooks/issue-edited";
import { handleGiteaIssueLabeled } from "../../src/integrations/gitea/webhooks/issue-labeled";
import { handleGitlabIssueUpdated } from "../../src/integrations/gitlab/webhooks/issue-updated";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
});

it.each([
  ["gitea", "text"],
  ["gitlab", "text"],
  ["gitea", "priority"],
  ["gitlab", "priority"],
  ["gitea", "label"],
  ["gitlab", "label"],
  ["gitea", "label-delete"],
  ["gitlab", "label-delete"],
])(
  "announces committed %s %s edits to observing boards",
  async (provider, kind) => {
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
    // The previous suite stubbed the repository lookup; here the config
    // names the repository the payload comes from.
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: provider,
      config: JSON.stringify({
        baseUrl:
          provider === "gitea"
            ? "https://gitea.example"
            : "https://gitlab.example",
        repositoryOwner: "owner",
        repositoryName: "repo",
        projectPath: "owner/repo",
        accessToken: "fake-test-token",
      }),
      isActive: true,
    });
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
    const events = app.get(EventBus);
    const publish = vi
      .spyOn(events, "publish")
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
      html_url: "https://gitea.example/owner/repo/issues/1",
    };
    const repository = {
      name: "repo",
      owner: { login: "owner" },
      html_url: "https://gitea.example/owner/repo",
    };
    if (provider === "gitea") {
      if (kind === "text") {
        await handleGiteaIssueEdited(app.db, events, {
          action: "edited",
          issue,
          repository,
          changes: { title: { from: "Before" }, body: { from: "Before body" } },
        });
      } else {
        const label = {
          name: kind === "priority" ? "priority:high" : "bug",
          color: "ff0000",
        };
        await handleGiteaIssueLabeled(app.db, events, {
          action: kind === "label-delete" ? "unlabeled" : "labeled",
          issue: { ...issue, labels: kind === "label-delete" ? [] : [label] },
          label,
          repository,
        });
      }
    } else {
      const label = {
        title: kind === "priority" ? "priority:high" : "bug",
        color: "#ff0000",
      };
      await handleGitlabIssueUpdated(app.db, events, {
        object_attributes: {
          iid: 1,
          title: "After",
          description: "After body",
          url: "https://gitlab.example/owner/repo/-/issues/1",
          action: "update",
        },
        changes:
          kind === "text"
            ? {
                title: { previous: "Before", current: "After" },
                description: { previous: "Before body", current: "After body" },
              }
            : {
                labels: {
                  previous: kind === "label-delete" ? [label] : [],
                  current: kind === "label-delete" ? [] : [label],
                },
              },
        project: {
          name: "repo",
          web_url: "https://gitlab.example/owner/repo",
          path_with_namespace: "owner/repo",
        },
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
        kind === "text" || (kind === "priority" && provider !== "gitlab")
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
