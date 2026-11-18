// Ported from tests/api-integration/integration-sync-field-labels.test.ts
// (GitHub cases; the Gitea/GitLab ones are listed as skipped).
import { Logger } from "@nestjs/common";
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
import { TaskEntity } from "../../src/database/entities/task.entity";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { GitHubPlugin } from "../../src/integrations/github/github.plugin";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type Overlap = boolean | string;

function overlaps(field: "status" | "priority", gitea: boolean): Overlap[] {
  return field === "priority"
    ? [
        false,
        true,
        "clear",
        "read-error",
        "initialization",
        "initialization-waits",
        ...(gitea
          ? ["initialization-list-error", "initialization-remove-error"]
          : []),
      ]
    : [false, true, "initialization", "initialization-waits"];
}

describe("GitHub issue field labels", () => {
  const double = createGitHubAppDouble();
  const { octokit } = double;
  const read = vi.fn();
  const write = vi.fn();
  let labels = new Set<string>();
  let app: TestApp;
  const issue = () => ({
    title: "Task",
    body: "",
    state: "open",
    labels: [...labels],
    updated_at: "2026-10-04T00:00:00Z",
  });

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.restoreAllMocks();
    double.reset();
    write.mockReset().mockResolvedValue(undefined);
    read.mockReset().mockImplementation(() => issue());
    labels = new Set(["status:planned", "priority:low", "keep"]);
    octokit.rest.issues.get.mockImplementation(async () => ({
      data: await read(),
    }));
    octokit.rest.issues.getLabel.mockResolvedValue({});
    octokit.rest.issues.removeLabel.mockImplementation(
      async ({ name }: { name: string }) => {
        labels.delete(name);
      },
    );
    octokit.rest.issues.addLabels.mockImplementation(
      async ({ labels: names }: { labels: string[] }) => {
        await write();
        for (const name of names) labels.add(name);
      },
    );
  });

  it.each(
    (["status", "priority"] as const).flatMap((field) =>
      overlaps(field, false).map((overlap) => ({ field, overlap })),
    ),
  )(
    "github replaces actual $field labels after resume (overlap=$overlap)",
    async ({ field, overlap }) => {
      const { workspace, user } = await createWorkspaceMember(app.db);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });
      const clearing = overlap === "clear";
      const initializing =
        typeof overlap === "string" && overlap.startsWith("initialization");
      const overlapping = overlap === true || initializing;
      const first =
        field === "status" ? "in-progress" : clearing ? "no-priority" : "high";
      const last = field === "status" ? "in-review" : "urgent";
      const task = await createTask(app.db, {
        projectId: project.id,
        number: 1,
        title: "Task",
        status: "in-progress",
        priority: field === "priority" ? first : "high",
      });
      const config = {
        repositoryOwner: "team",
        repositoryName: "repo",
        installationId: 1,
        repositoryId: 2,
        verifiedGithubAccountId: "3",
        verifiedByUserId: user.id,
        commentTaskLinkOnGitHubIssue: false,
      };
      const integration = await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "github",
        isActive: true,
        config: JSON.stringify(config),
      });
      const link = await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: "1",
        url: "https://git.example/team/repo/issues/1",
        metadata: JSON.stringify({
          syncResumeLabelBaseline: [...labels],
          ...(initializing
            ? {
                syncInitializationPending: true,
                syncInitializedState: true,
                syncCreatedText: { title: "Task", description: "" },
              }
            : {}),
        }),
      });
      const plugin = app.get(GitHubPlugin);
      const context = {
        integrationId: integration.id,
        projectId: project.id,
        config,
      };
      const sync = (oldValue: string, value: string) =>
        field === "status"
          ? plugin.onTaskStatusChanged(
              {
                taskId: task.id,
                projectId: project.id,
                userId: user.id,
                title: task.title,
                oldStatus: oldValue,
                newStatus: value,
              },
              context,
            )
          : plugin.onTaskPriorityChanged(
              {
                taskId: task.id,
                projectId: project.id,
                userId: user.id,
                title: task.title,
                oldPriority: oldValue,
                newPriority: value,
              },
              context,
            );
      const initialize = () =>
        plugin.onTaskCreated(
          {
            taskId: task.id,
            projectId: project.id,
            userId: user.id,
            title: task.title,
            description: null,
            status: task.status,
            priority: task.priority,
            number: 1,
          },
          context,
        );
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writing = new Promise<void>((resolve) => {
        started = resolve;
      });
      if (overlapping)
        write.mockImplementationOnce(async () => {
          started();
          await gate;
        });
      if (overlap === "read-error") {
        const errors = vi
          .spyOn(Logger.prototype, "error")
          .mockImplementation(() => {});
        const privateError = Object.assign(
          new Error("fake-private-provider-body"),
          {
            request: {
              headers: { authorization: "fake-private-provider-token" },
            },
          },
        );
        read.mockRejectedValueOnce(privateError);
        await sync(field === "status" ? "to-do" : "urgent", first);
        const output = errors.mock.calls
          .flatMap((args) =>
            args.map((value) => String(value) + JSON.stringify(value)),
          )
          .join("\n");
        expect(output).not.toContain("fake-private-provider");
        expect(output).toContain(integration.id);
        expect(output).toContain(link.id);
        expect(write).not.toHaveBeenCalled();
        return;
      }
      const initial =
        overlap === "initialization"
          ? initialize()
          : sync(field === "status" ? "to-do" : "urgent", first);
      if (overlapping) {
        await writing;
        // A slow provider request must not hold task or project row locks.
        await app.db.update(TaskEntity, { id: task.id }, { [field]: last });
        const later =
          overlap === "initialization-waits" ? initialize() : sync(first, last);
        release();
        await Promise.all([initial, later]);
      } else await initial;
      const expected = `${field}:${overlapping ? last : first}`;
      expect([...labels].filter((name) => name.startsWith(`${field}:`))).toEqual(
        clearing ? [] : [expected],
      );
      expect(labels.has("keep")).toBe(true);
      expect(
        labels.has(
          field === "status"
            ? initializing
              ? "priority:high"
              : "priority:low"
            : initializing
              ? "status:in-progress"
              : "status:planned",
        ),
      ).toBe(true);
      const saved = await app.db.findOneOrFail(ExternalLinkEntity, {
        where: { id: link.id },
      });
      const metadata = JSON.parse(saved.metadata!);
      if (initializing)
        expect(metadata).toMatchObject({
          syncInitializedLabels: true,
          syncInitializationPending: false,
        });
      if (!clearing) expect(metadata.syncResumeLabelBaseline).toContain(expected);
      expect(metadata.syncResumeLabelBaseline).not.toContain(
        `${field}:${field === "status" ? "planned" : "low"}`,
      );
    },
  );

  // The Gitea/GitLab cases are in test/integration/gitea-sync-field-labels.test.ts and gitlab-sync-field-labels.test.ts.
});
