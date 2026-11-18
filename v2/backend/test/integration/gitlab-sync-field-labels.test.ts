import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { GitlabPlugin } from "../../src/integrations/gitlab/gitlab.plugin";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// The GitLab cases of tests/api-integration/integration-sync-field-labels.test.ts.
const mocks = vi.hoisted(() => ({
  labels: new Set<string>(),
  read: vi.fn(),
  write: vi.fn(),
}));
const names = [
  "status:planned",
  "status:in-progress",
  "status:in-review",
  "priority:low",
  "priority:high",
  "priority:urgent",
  "keep",
];
const available = () => names.map((name, id) => ({ name, id: id + 1 }));
const issue = () => ({
  title: "Task",
  body: "",
  state: "open",
  labels: [...mocks.labels],
  updated_at: "2026-10-04T00:00:00Z",
});
vi.mock("../../src/integrations/gitlab/client/gitlab-client", () => ({
  createGitlabClient: () => ({
    getIssue: async () => mocks.read(),
    listLabels: async () => available(),
    updateIssue: async (
      _project: string,
      _number: number,
      body: { add_labels?: string; remove_labels?: string },
    ) => {
      await mocks.write();
      for (const name of body.remove_labels?.split(",") ?? [])
        mocks.labels.delete(name);
      for (const name of body.add_labels?.split(",") ?? [])
        mocks.labels.add(name);
      return issue();
    },
  }),
}));

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  vi.restoreAllMocks();
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.read.mockReset().mockImplementation(() => issue());
  mocks.labels = new Set(["status:planned", "priority:low", "keep"]);
});

it.each(
  (["status", "priority"] as const).flatMap((field) =>
    (field === "priority"
      ? [
          false,
          true,
          "clear",
          "read-error",
          "initialization",
          "initialization-waits",
        ]
      : [false, true, "initialization", "initialization-waits"]
    ).map((overlap) => ({ field, overlap })),
  ),
)(
  "gitlab replaces actual $field labels after resume (overlap=$overlap)",
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
      baseUrl: "https://git.example",
      accessToken: "fake-test-token",
      repositoryOwner: "team",
      repositoryName: "repo",
      projectPath: "team/repo",
      installationId: 1,
      repositoryId: 2,
      verifiedGithubAccountId: "3",
      verifiedByUserId: user.id,
      commentTaskLinkOnGitHubIssue: false,
    };
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "gitlab",
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
        syncResumeLabelBaseline: [...mocks.labels],
        ...(initializing
          ? {
              syncInitializationPending: true,
              syncInitializedState: true,
              syncCreatedText: { title: "Task", description: "" },
            }
          : {}),
      }),
    });
    const plugin = app.get(GitlabPlugin);
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
      mocks.write.mockImplementationOnce(async () => {
        started();
        await gate;
      });
    if (overlap === "read-error") {
      const errors = vi.spyOn(Logger.prototype, "error");
      const privateError = Object.assign(
        new Error("fake-private-provider-body"),
        {
          request: {
            headers: { authorization: "fake-private-provider-token" },
          },
        },
      );
      mocks.read.mockRejectedValueOnce(privateError);
      await sync("urgent", first);
      const output = errors.mock.calls
        .flatMap((args) =>
          args.map((value) => String(value) + JSON.stringify(value)),
        )
        .join("\n");
      expect(output).not.toContain("fake-private-provider");
      expect(output).toContain(integration.id);
      expect(output).toContain(link.id);
      expect(mocks.write).not.toHaveBeenCalled();
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
    expect(
      [...mocks.labels].filter((name) => name.startsWith(`${field}:`)),
    ).toEqual(clearing ? [] : [expected]);
    expect(mocks.labels.has("keep")).toBe(true);
    expect(
      mocks.labels.has(
        field === "status"
          ? initializing
            ? "priority:high"
            : "priority:low"
          : initializing
            ? "status:in-progress"
            : "status:planned",
      ),
    ).toBe(true);
    const saved = await app.db.findOne(ExternalLinkEntity, {
      where: { id: link.id },
    });
    if (initializing)
      expect(JSON.parse(saved!.metadata!)).toMatchObject({
        syncInitializedLabels: true,
        syncInitializationPending: false,
      });
    if (!clearing)
      expect(JSON.parse(saved!.metadata!).syncResumeLabelBaseline).toContain(
        expected,
      );
    expect(JSON.parse(saved!.metadata!).syncResumeLabelBaseline).not.toContain(
      `${field}:${field === "status" ? "planned" : "low"}`,
    );
  },
);
