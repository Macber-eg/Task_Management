import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ActivityEntity } from "../../src/database/entities/activity.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { handleGitlabIssueOpened } from "../../src/integrations/gitlab/webhooks/issue-opened";
import {
  handleGitlabIssueClosed,
  handleGitlabIssueReopened,
} from "../../src/integrations/gitlab/webhooks/issue-state";
import { handleGitlabIssueUpdated } from "../../src/integrations/gitlab/webhooks/issue-updated";
import { handleGitlabMergeRequestClosed } from "../../src/integrations/gitlab/webhooks/merge-request-closed";
import { handleGitlabMergeRequestOpened } from "../../src/integrations/gitlab/webhooks/merge-request-opened";
import { handleGitlabNoteCreated } from "../../src/integrations/gitlab/webhooks/note-created";
import { handleGitlabPush } from "../../src/integrations/gitlab/webhooks/push";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import {
  type GitlabFakeServer,
  gitlabProjectApi,
  startGitlabFakeServer,
} from "../support/fixtures/gitlab-fake-server";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/gitlab-completed-task-status.test.ts, the
// webhook half of gitlab-sync-boundaries.test.ts and the mocked-database cases
// of tests/api/plugins/gitlab/webhooks/*.test.ts, against PostgreSQL and a
// fake GitLab. The HTTP route itself is covered at the end.
describe("GitLab webhooks", () => {
  let app: TestApp;
  let gitlab: GitlabFakeServer;
  let events: EventBus;

  beforeAll(async () => {
    app = await createTestApp();
    gitlab = await startGitlabFakeServer();
    events = app.get(EventBus);
  });
  afterAll(async () => {
    await gitlab.close();
    await app.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    gitlab.reset();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const projectPayload = () => ({
    name: "project",
    web_url: `${gitlab.baseUrl}/group/project`,
    path_with_namespace: "group/project",
  });

  async function createFixture(config: Record<string, unknown> = {}) {
    const member = await createWorkspaceMember(app.db);
    const { project, columns } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "KAN",
    });
    const integration = await insertRow(app.db, IntegrationEntity, {
      projectId: project.id,
      type: "gitlab",
      isActive: true,
      config: JSON.stringify({
        baseUrl: gitlab.baseUrl,
        projectPath: "group/project",
        accessToken: "fake-test-token",
        branchPattern: "{slug}-{number}",
        ...config,
      }),
    });
    const task = await createTask(app.db, {
      projectId: project.id,
      number: 42,
      title: "Task 42",
      description: "Local description",
      status: "done",
      columnId: columns.done.id,
      priority: "medium",
      position: 0,
    });
    await app.db.query(
      `UPDATE project SET last_task_number = 42 WHERE id = $1`,
      [project.id],
    );
    return { ...member, project, columns, integration, task };
  }

  const taskOf = (id: string) =>
    app.db.findOne(TaskEntity, { where: { id } });

  describe("merge requests on a completed task", () => {
    let fixture: Awaited<ReturnType<typeof createFixture>>;

    const mergeRequest = (
      overrides: { draft?: boolean; branch?: string; description?: string } = {},
    ) => ({
      object_attributes: {
        iid: 7,
        title: "Slice 2",
        description: overrides.description ?? null,
        url: `${gitlab.baseUrl}/group/project/-/merge_requests/7`,
        state: "opened",
        draft: overrides.draft ?? false,
        source_branch: overrides.branch ?? "kan-42-slice-2",
      },
      project: projectPayload(),
    });
    const status = async () => (await taskOf(fixture.task.id))?.status;
    const complete = () =>
      app.db.update(
        TaskEntity,
        { id: fixture.task.id },
        { status: "done", columnId: fixture.columns.done.id },
      );

    beforeEach(async () => {
      fixture = await createFixture();
    });

    it("moves the task to review when a draft becomes ready", async () => {
      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest({ draft: true }),
        fixture.integration.id,
        { moveTask: false },
      );
      expect(await status()).toBe("done");

      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest(),
        fixture.integration.id,
      );
      expect(await status()).toBe("in-review");
    });

    it("keeps the task done for a repeated ready delivery", async () => {
      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest(),
        fixture.integration.id,
      );
      await complete();
      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest(),
        fixture.integration.id,
      );
      expect(await status()).toBe("done");
    });

    it("links a merge request through the task link", async () => {
      const taskLink = `https://kaneo.example.com/dashboard/workspace/w/project/${fixture.project.id}/task/${fixture.task.id}`;
      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest({ branch: "unrelated", description: taskLink }),
        fixture.integration.id,
      );
      expect(await status()).toBe("in-review");
    });

    it("does not move a task that moved to another project", async () => {
      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest({ draft: true }),
        fixture.integration.id,
        { moveTask: false },
      );
      const other = await createProjectFixture(app.db, {
        workspaceId: fixture.project.workspaceId,
        slug: "OTHER",
      });
      await app.db.update(
        TaskEntity,
        { id: fixture.task.id },
        { projectId: other.project.id, columnId: other.columns.done.id },
      );

      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest(),
        fixture.integration.id,
      );
      expect(await status()).toBe("done");
    });

    it("records a merge and moves the task once no merge request is open", async () => {
      await app.db.update(
        TaskEntity,
        { id: fixture.task.id },
        { status: "in-progress", columnId: fixture.columns.inProgress.id },
      );
      await handleGitlabMergeRequestOpened(
        app.db,
        events,
        mergeRequest(),
        fixture.integration.id,
      );
      const published = vi.spyOn(events, "publish");

      await handleGitlabMergeRequestClosed(
        app.db,
        events,
        {
          object_attributes: {
            ...mergeRequest().object_attributes,
            state: "merged",
            action: "merge",
          },
          project: projectPayload(),
        },
        fixture.integration.id,
      );

      expect(await status()).toBe("done");
      const link = await app.db.findOne(ExternalLinkEntity, {
        where: { resourceType: "pull_request" },
      });
      expect(JSON.parse(link!.metadata!)).toMatchObject({
        state: "merged",
        draft: false,
        merged: true,
      });
      expect(published).toHaveBeenCalledWith(
        "task.status_changed",
        expect.objectContaining({ oldStatus: "in-review", newStatus: "done" }),
      );
    });
  });

  describe("pushes to a completed task", () => {
    let fixture: Awaited<ReturnType<typeof createFixture>>;

    const push = (after?: string) =>
      handleGitlabPush(
        app.db,
        events,
        {
          after,
          ref: "refs/heads/kan-42-slice-2",
          project: projectPayload(),
        },
        fixture.integration.id,
      );
    const status = async () => (await taskOf(fixture.task.id))?.status;

    beforeEach(async () => {
      fixture = await createFixture();
    });

    it("moves the task back to progress for a new branch", async () => {
      await push();
      expect(await status()).toBe("in-progress");
      expect(
        await app.db.findOne(ExternalLinkEntity, {
          where: { resourceType: "branch" },
        }),
      ).toMatchObject({
        externalId: "kan-42-slice-2",
        url: `${gitlab.baseUrl}/group/project/-/tree/kan-42-slice-2`,
      });
    });

    it("keeps the task done for a push to an already linked branch", async () => {
      await push();
      await app.db.update(
        TaskEntity,
        { id: fixture.task.id },
        { status: "done", columnId: fixture.columns.done.id },
      );
      await push();
      expect(await status()).toBe("done");
    });

    it("ignores a push that deletes the branch", async () => {
      await push("0".repeat(40));
      expect(await status()).toBe("done");
    });
  });

  describe("issue opened", () => {
    const issueOpenedPayload = (labels: Array<{ title: string }>) => ({
      user: { username: "octocat" },
      object_attributes: {
        iid: 42,
        title: "Fix the login bug",
        description: "Steps to reproduce",
        url: `${gitlab.baseUrl}/group/project/-/issues/42`,
        action: "open",
      },
      labels,
      project: projectPayload(),
    });

    beforeEach(() => {
      const api = gitlabProjectApi("group/project");
      gitlab.on("GET", `${api}/labels`, []);
      gitlab.on("POST", `${api}/labels`, { id: 1, name: "x" });
      gitlab.on("PUT", `${api}/issues/42`, { iid: 42 });
      gitlab.on("POST", `${api}/issues/42/notes`, { id: 99 });
    });

    it("persists a valid default priority when the issue has no priority: label", async () => {
      const { integration } = await createFixture();
      await handleGitlabIssueOpened(
        app.db,
        events,
        issueOpenedPayload([{ title: "type:bug" }]),
        integration.id,
      );
      const created = await app.db.findOne(TaskEntity, {
        where: { title: "Fix the login bug" },
      });
      expect(created).toMatchObject({ priority: "low", number: 43 });
    });

    it("reads the priority label out of the webhook's label titles", async () => {
      const { integration } = await createFixture();
      await handleGitlabIssueOpened(
        app.db,
        events,
        issueOpenedPayload([{ title: "type:bug" }, { title: "priority:high" }]),
        integration.id,
      );
      expect(
        await app.db.findOne(TaskEntity, {
          where: { title: "Fix the login bug" },
        }),
      ).toMatchObject({ priority: "high" });
    });

    it("records the issue link before publishing task.created, then comments the task link", async () => {
      const { integration, project } = await createFixture();
      const published = vi.spyOn(events, "publish");
      let linkedAtPublish = false;
      published.mockImplementation(async function (this: EventBus, type) {
        if (type === "task.created")
          linkedAtPublish =
            (await app.db.count(ExternalLinkEntity, {
              where: { externalId: "42" },
            })) === 1;
      });

      await handleGitlabIssueOpened(
        app.db,
        events,
        issueOpenedPayload([]),
        integration.id,
      );

      expect(linkedAtPublish).toBe(true);
      const created = await app.db.findOne(TaskEntity, {
        where: { title: "Fix the login bug" },
      });
      expect(published).toHaveBeenCalledWith(
        "task.created",
        expect.objectContaining({
          taskId: created!.id,
          source: "gitlab",
          externalId: "42",
          actor: "octocat",
        }),
      );
      const link = await app.db.findOne(ExternalLinkEntity, {
        where: { externalId: "42", resourceType: "issue" },
      });
      expect(link).toMatchObject({
        url: `${gitlab.baseUrl}/group/project/-/issues/42`,
      });
      expect(JSON.parse(link!.metadata!)).toMatchObject({
        state: "opened",
        createdFrom: "gitlab",
        author: "octocat",
        syncedNoteIds: [99],
      });
      const note = gitlab.calls(
        "POST",
        `${gitlabProjectApi("group/project")}/issues/42/notes`,
      )[0];
      expect(note?.body).toEqual({
        body: `[KAN-43](http://localhost:5173/dashboard/workspace/${project.workspaceId}/project/${project.id}/task/${created!.id})`,
      });
    });

    it("keeps a confidential issue out of the workspace", async () => {
      const { integration } = await createFixture();
      const payload = issueOpenedPayload([]);
      await handleGitlabIssueOpened(
        app.db,
        events,
        {
          ...payload,
          object_attributes: { ...payload.object_attributes, confidential: true },
        },
        integration.id,
      );
      expect(await app.db.count(TaskEntity)).toBe(1);
    });

    it("skips an issue that already has a task", async () => {
      const { integration, task } = await createFixture();
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: "42",
        url: "https://gitlab.example/issues/42",
      });
      await handleGitlabIssueOpened(
        app.db,
        events,
        issueOpenedPayload([]),
        integration.id,
      );
      expect(await app.db.count(TaskEntity)).toBe(1);
    });
  });

  describe("issue state", () => {
    const statePayload = (action: "close" | "reopen") => ({
      object_attributes: {
        iid: 3,
        title: "Checkout button overlaps the footer",
        url: `${gitlab.baseUrl}/group/project/-/issues/3`,
        state: action === "close" ? "closed" : "opened",
        action,
      },
      project: projectPayload(),
    });

    async function linked(metadata: Record<string, unknown>) {
      const fixture = await createFixture();
      const link = await insertRow(app.db, ExternalLinkEntity, {
        taskId: fixture.task.id,
        integrationId: fixture.integration.id,
        resourceType: "issue",
        externalId: "3",
        url: "https://gitlab.example/issues/3",
        metadata: JSON.stringify(metadata),
      });
      return { ...fixture, link };
    }

    it("marks the link as opened after moving the task", async () => {
      const { integration, task, link } = await linked({ state: "closed" });
      const published = vi.spyOn(events, "publish");

      await handleGitlabIssueReopened(
        app.db,
        events,
        statePayload("reopen"),
        integration.id,
      );

      expect(await taskOf(task.id)).toMatchObject({ status: "to-do" });
      const stored = await app.db.findOne(ExternalLinkEntity, {
        where: { id: link.id },
      });
      expect(JSON.parse(stored!.metadata!)).toMatchObject({ state: "opened" });
      expect(published).toHaveBeenCalledWith(
        "task.status_changed",
        expect.objectContaining({
          sourceIntegrationId: integration.id,
          newStatus: "to-do",
        }),
      );
    });

    it("skips the echo of a close Kaneo itself sent", async () => {
      const { integration, task, columns } = await linked({
        state: "closed",
        lastOutboundStateSyncAt: Date.now(),
      });
      await app.db.update(
        TaskEntity,
        { id: task.id },
        { status: "in-progress", columnId: columns.inProgress.id },
      );

      await handleGitlabIssueClosed(
        app.db,
        events,
        {
          ...statePayload("close"),
          object_attributes: {
            ...statePayload("close").object_attributes,
            updated_at: new Date().toISOString(),
          },
        },
        integration.id,
      );

      expect(await taskOf(task.id)).toMatchObject({ status: "in-progress" });
    });

    it("moves the task to done for a close from GitLab", async () => {
      const { integration, task, columns } = await linked({ state: "opened" });
      await app.db.update(
        TaskEntity,
        { id: task.id },
        { status: "in-progress", columnId: columns.inProgress.id },
      );

      await handleGitlabIssueClosed(
        app.db,
        events,
        statePayload("close"),
        integration.id,
      );

      expect(await taskOf(task.id)).toMatchObject({
        status: "done",
        columnId: columns.done.id,
      });
    });
  });

  describe("issue updated", () => {
    const remoteIssue = {
      iid: 1,
      title: "Remote title",
      description: "Remote description",
      state: "opened",
    };
    const label = (title: string) => ({ title, color: "#123456" });

    async function linked(metadata: Record<string, unknown> | null = null) {
      const fixture = await createFixture();
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: fixture.task.id,
        integrationId: fixture.integration.id,
        resourceType: "issue",
        externalId: "1",
        url: "https://gitlab.example/issues/1",
        metadata: metadata ? JSON.stringify(metadata) : null,
      });
      return fixture;
    }

    const titleChangedPayload = (title: string) => ({
      object_attributes: {
        ...remoteIssue,
        title,
        url: `${gitlab.baseUrl}/group/project/-/issues/1`,
        action: "update",
      },
      changes: { title: { previous: "Old title", current: title } },
      project: projectPayload(),
    });

    const writtenByKaneo = (title: string) => ({
      state: "open",
      lastSync: {
        title: {
          // Just now, so a window-based guard would swallow both cases below.
          timestamp: new Date().toISOString(),
          source: "kaneo",
          value: title,
        },
      },
    });

    it("applies a title edit that arrives from GitLab", async () => {
      const { integration, task } = await linked({ state: "open" });
      const published = vi.spyOn(events, "publish");
      await handleGitlabIssueUpdated(
        app.db,
        events,
        titleChangedPayload("Fix the login bug"),
        integration.id,
      );
      expect(await taskOf(task.id)).toMatchObject({
        title: "Fix the login bug",
        description: "Local description",
      });
      expect(published).toHaveBeenCalledWith("task.updated", {
        projectId: integration.projectId,
        taskId: task.id,
        titleChanged: true,
      });
    });

    it("ignores the echo of a title Kaneo just wrote", async () => {
      const { integration, task } = await linked(
        writtenByKaneo("Written by Kaneo"),
      );
      await handleGitlabIssueUpdated(
        app.db,
        events,
        titleChangedPayload("Written by Kaneo"),
        integration.id,
      );
      expect(await taskOf(task.id)).toMatchObject({ title: "Task 42" });
    });

    it("keeps a different title edited right after Kaneo's own write", async () => {
      const { integration, task } = await linked(
        writtenByKaneo("Written by Kaneo"),
      );
      await handleGitlabIssueUpdated(
        app.db,
        events,
        titleChangedPayload("Edited in GitLab"),
        integration.id,
      );
      expect(await taskOf(task.id)).toMatchObject({ title: "Edited in GitLab" });
    });

    it("does nothing when the update changed neither text nor labels", async () => {
      const { integration, task } = await linked();
      await handleGitlabIssueUpdated(
        app.db,
        events,
        { ...titleChangedPayload("Fix the login bug"), changes: {} },
        integration.id,
      );
      expect(await taskOf(task.id)).toMatchObject({ title: "Task 42" });
    });

    it.each([
      {
        name: "remote removal and addition",
        previous: [label("removed")],
        current: [label("added")],
        expected: ["added", "local"],
      },
      {
        name: "removing the last remote label",
        previous: [label("removed")],
        current: [],
        expected: ["local"],
      },
      {
        name: "missing previous labels",
        previous: undefined,
        current: [label("added")],
        expected: ["added", "local", "removed"],
      },
      {
        name: "missing current labels",
        previous: [label("removed")],
        current: undefined,
        expected: ["local", "removed"],
      },
    ])(
      "preserves local labels when $name",
      async ({ previous, current, expected }) => {
        const { task, workspace, integration } = await linked();
        for (const name of ["local", "removed"])
          await insertRow(app.db, LabelEntity, {
            name,
            taskId: task.id,
            workspaceId: workspace.id,
            color: "#123456",
          });
        const payload = {
          object_attributes: {
            ...remoteIssue,
            url: `${gitlab.baseUrl}/group/project/-/issues/1`,
            action: "update",
          },
          project: projectPayload(),
          changes: { labels: { previous, current } },
        };
        await handleGitlabIssueUpdated(app.db, events, payload, integration.id);
        // Redelivery must preserve the same result.
        await handleGitlabIssueUpdated(app.db, events, payload, integration.id);
        const saved = await app.db.find(LabelEntity, {
          where: { taskId: task.id },
        });
        expect(saved.map((row) => row.name).sort()).toEqual(expected);
      },
    );

    it.each([
      { statusLabel: "status:to-do", expected: "done" },
      { statusLabel: "status:in-progress", expected: "in-progress" },
    ])(
      "applies only changed status labels: $statusLabel → $expected",
      async ({ statusLabel, expected }) => {
        const { task, integration } = await linked();
        await handleGitlabIssueUpdated(
          app.db,
          events,
          {
            object_attributes: {
              ...remoteIssue,
              url: `${gitlab.baseUrl}/group/project/-/issues/1`,
              action: "update",
            },
            project: projectPayload(),
            changes: {
              labels: {
                previous: [label("status:to-do")],
                current: [label(statusLabel), label("bug")],
              },
            },
          },
          integration.id,
        );
        expect(await taskOf(task.id)).toMatchObject({ status: expected });
      },
    );
  });

  describe("note created", () => {
    const notePayload = (
      overrides: {
        id?: number;
        internal?: boolean;
        system?: boolean;
        eventType?: string;
      } = {},
    ) => ({
      event_type: overrides.eventType ?? "note",
      user: { username: "octocat" },
      object_attributes: {
        id: overrides.id ?? 10,
        note: "Reproduced on Firefox too.",
        noteable_type: "Issue",
        url: `${gitlab.baseUrl}/group/project/-/issues/3#note_10`,
        system: overrides.system ?? false,
        internal: overrides.internal ?? false,
      },
      issue: { iid: 3 },
      project: projectPayload(),
    });

    async function linked(metadata: Record<string, unknown>) {
      const fixture = await createFixture();
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: fixture.task.id,
        integrationId: fixture.integration.id,
        resourceType: "issue",
        externalId: "3",
        url: "https://gitlab.example/issues/3",
        metadata: JSON.stringify(metadata),
      });
      return fixture;
    }
    const activities = (taskId: string) =>
      app.db.find(ActivityEntity, { where: { taskId } });

    it("copies a comment into the task activity", async () => {
      const { integration, task } = await linked({ state: "opened" });
      await handleGitlabNoteCreated(app.db, notePayload(), integration.id);
      await handleGitlabNoteCreated(app.db, notePayload(), integration.id);
      const rows = await activities(task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "comment",
        externalSource: "gitlab",
        externalUserName: "octocat",
        content: "Reproduced on Firefox too.",
        eventData: { externalCommentId: 10 },
      });
    });

    it.each([
      ["an internal note", { internal: true }],
      ["a comment on a confidential issue", { eventType: "confidential_note" }],
      ["a system note", { system: true }],
    ])("keeps %s out of the workspace", async (_name, overrides) => {
      const { integration, task } = await linked({ state: "opened" });
      await handleGitlabNoteCreated(
        app.db,
        notePayload(overrides),
        integration.id,
      );
      expect(await activities(task.id)).toHaveLength(0);
    });

    it("skips a note Kaneo posted itself", async () => {
      const { integration, task } = await linked({ syncedNoteIds: [10] });
      await handleGitlabNoteCreated(
        app.db,
        notePayload({ id: 10 }),
        integration.id,
      );
      expect(await activities(task.id)).toHaveLength(0);
    });
  });

  describe("webhook route", () => {
    const deliver = (
      integrationId: string,
      body: unknown,
      token?: string,
    ) =>
      app.request(`/api/gitlab-integration/webhook/${integrationId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Gitlab-Token": token } : {}),
        },
        body: JSON.stringify(body),
      });

    it("authenticates by the integration's token and dispatches the event", async () => {
      const { integration, task, columns } = await createFixture({
        webhookSecret: "secret-token",
      });
      await app.db.update(
        TaskEntity,
        { id: task.id },
        { status: "to-do", columnId: columns.todo.id },
      );
      const push = {
        object_kind: "push",
        ref: "refs/heads/kan-42-work",
        project: projectPayload(),
      };

      const rejected = await deliver(integration.id, push, "wrong");
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ error: "Invalid webhook token" });
      expect(await taskOf(task.id)).toMatchObject({ status: "to-do" });

      const accepted = await deliver(integration.id, push, "secret-token");
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ status: "success" });
      expect(await taskOf(task.id)).toMatchObject({ status: "in-progress" });
    });

    it("answers the previous errors for unknown integrations and payloads", async () => {
      const { integration } = await createFixture({ webhookSecret: "s" });
      const unknown = await deliver("missing", { object_kind: "push" }, "s");
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual({
        error: "GitLab integration not found",
      });
      const noKind = await deliver(integration.id, {}, "s");
      expect(await noKind.json()).toEqual({ error: "Missing object_kind" });

      const noSecret = await createFixture();
      const unconfigured = await deliver(noSecret.integration.id, {}, "s");
      expect(await unconfigured.json()).toEqual({
        error: "Webhook secret not configured",
      });
    });
  });
});
