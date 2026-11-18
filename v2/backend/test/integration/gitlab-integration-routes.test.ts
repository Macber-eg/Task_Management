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
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
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

// Ported from tests/api/gitlab-integration/*.test.ts and the import half of
// tests/api-integration/gitlab-sync-boundaries.test.ts, against the real
// routes and a fake GitLab instead of mocked modules.
describe("GitLab integration routes", () => {
  let app: TestApp;
  let gitlab: GitlabFakeServer;

  beforeAll(async () => {
    app = await createTestApp();
    gitlab = await startGitlabFakeServer();
  });
  afterAll(async () => {
    await gitlab.close();
    await app.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    gitlab.reset();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    gitlab.on("GET", "/api/v4/user", { id: 1, username: "kaneo" });
    gitlab.on("GET", gitlabProjectApi("acme/web"), {
      id: 2,
      visibility: "private",
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function setup(role = "owner") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
      slug: "kan",
    });
    app.auth.signIn(member.user);
    return { ...member, project };
  }

  const json = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function storedConfig(projectId: string) {
    const row = await app.db.findOne(IntegrationEntity, {
      where: { projectId, type: "gitlab" },
    });
    return JSON.parse(row!.config) as Record<string, unknown>;
  }

  describe("create on an existing integration", () => {
    it("keeps the settings saved for the integration", async () => {
      const { project } = await setup();
      await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "gitlab",
        config: JSON.stringify({
          baseUrl: gitlab.baseUrl,
          accessToken: "old-token",
          tokenType: "private",
          projectPath: "acme/web",
          webhookSecret: "existing-secret",
          branchPattern: "custom",
          customBranchRegex: "^feature/(\\d+)",
          commentTaskLinkOnGitlabIssue: false,
          statusTransitions: { onPROpen: "review", onPRMerge: "shipped" },
        }),
      });
      const published = vi.spyOn(app.get(EventBus), "publish");

      const response = await json(
        "POST",
        `/api/gitlab-integration/project/${project.id}`,
        {
          baseUrl: gitlab.baseUrl,
          accessToken: "new-token",
          tokenType: "private",
          projectPath: "acme/web",
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        projectId: project.id,
        baseUrl: gitlab.baseUrl,
        projectPath: "acme/web",
        tokenType: "private",
        maskedAccessToken: "new-••••••oken",
        webhookSecret: "existing-secret",
        webhookUrl: expect.stringMatching(
          /\/api\/gitlab-integration\/webhook\/.+$/,
        ),
        branchPattern: "custom",
        commentTaskLinkOnGitlabIssue: false,
        isActive: true,
      });
      expect(await storedConfig(project.id)).toMatchObject({
        accessToken: "new-token",
        webhookSecret: "existing-secret",
        branchPattern: "custom",
        customBranchRegex: "^feature/(\\d+)",
        commentTaskLinkOnGitlabIssue: false,
        statusTransitions: { onPROpen: "review", onPRMerge: "shipped" },
      });
      expect(published).toHaveBeenCalledWith(
        "integration.sync_rules_changed",
        expect.objectContaining({ projectId: project.id }),
      );
      expect(gitlab.calls("GET", "/api/v4/user")[0]?.headers).toMatchObject({
        "private-token": "new-token",
      });
    });

    it("reuses the stored token and fills defaults for settings never saved", async () => {
      const { project } = await setup();
      await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "gitlab",
        config: JSON.stringify({
          baseUrl: gitlab.baseUrl,
          accessToken: "old-token",
          projectPath: "acme/web",
          webhookSecret: "existing-secret",
        }),
      });

      const response = await json(
        "POST",
        `/api/gitlab-integration/project/${project.id}`,
        { baseUrl: gitlab.baseUrl, projectPath: "acme/web" },
      );

      expect(response.status).toBe(200);
      expect(await storedConfig(project.id)).toMatchObject({
        accessToken: "old-token",
        branchPattern: "{slug}-{number}",
        commentTaskLinkOnGitlabIssue: true,
        statusTransitions: { onPROpen: "in-review" },
      });
    });

    it("creates a new integration with a generated webhook secret", async () => {
      const { project } = await setup();

      const response = await json(
        "POST",
        `/api/gitlab-integration/project/${project.id}`,
        {
          baseUrl: `${gitlab.baseUrl}/`,
          accessToken: "glpat-abcdefghijklmnop",
          tokenType: "bearer",
          projectPath: "/acme/web/",
        },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        baseUrl: gitlab.baseUrl,
        projectPath: "acme/web",
        tokenType: "bearer",
        maskedAccessToken: "glpa••••••mnop",
      });
      expect(body.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
      expect(gitlab.calls("GET", "/api/v4/user")[0]?.headers).toMatchObject({
        authorization: "Bearer glpat-abcdefghijklmnop",
      });
    });

    it("refuses a GitLab project already linked to another Kaneo project", async () => {
      const { project, workspace } = await setup();
      const other = await createProjectFixture(app.db, {
        workspaceId: workspace.id,
      });
      await insertRow(app.db, IntegrationEntity, {
        projectId: other.project.id,
        type: "gitlab",
        isActive: true,
        config: JSON.stringify({
          baseUrl: gitlab.baseUrl,
          accessToken: "token",
          projectPath: "acme/web",
        }),
      });

      const response = await json(
        "POST",
        `/api/gitlab-integration/project/${project.id}`,
        {
          baseUrl: gitlab.baseUrl,
          accessToken: "token",
          projectPath: "acme/web",
        },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        message:
          "Project acme/web on this GitLab instance is already linked to another project",
      });
    });
  });

  describe("create input", () => {
    it("rejects a malformed project path with a 400", async () => {
      const { project } = await setup();

      const response = await json(
        "POST",
        `/api/gitlab-integration/project/${project.id}`,
        {
          baseUrl: gitlab.baseUrl,
          accessToken: "token",
          tokenType: "private",
          projectPath: "acme/../web",
        },
      );

      expect(response.status).toBe(400);
      expect(gitlab.requests).toHaveLength(0);
      expect(
        await app.db.count(IntegrationEntity, {
          where: { projectId: project.id },
        }),
      ).toBe(0);
    });
  });

  describe("saved GitLab credential destination", () => {
    async function savedIntegration() {
      const context = await setup();
      await insertRow(app.db, IntegrationEntity, {
        projectId: context.project.id,
        type: "gitlab",
        config: JSON.stringify({
          baseUrl: `${gitlab.baseUrl}/forge`,
          accessToken: "saved-secret",
          projectPath: "acme/web",
        }),
      });
      return context;
    }

    it.each([
      "https://attacker.example/forge",
      "FAKE/other",
      "http://127.0.0.2:1/forge",
    ])(
      "rejects changed destination %s before sending the saved credential",
      async (baseUrl) => {
        const { project } = await savedIntegration();
        const response = await json(
          "POST",
          `/api/gitlab-integration/project/${project.id}`,
          {
            baseUrl: baseUrl.replace("FAKE", gitlab.baseUrl),
            projectPath: "acme/web",
          },
        );
        expect(response.status).toBe(400);
        expect(gitlab.requests).toHaveLength(0);
      },
    );

    it("allows normalized equivalents of the saved destination", async () => {
      const { project } = await savedIntegration();
      gitlab.on("GET", "/forge/api/v4/user", { id: 1 });
      gitlab.on("GET", `/forge${gitlabProjectApi("acme/web")}`, { id: 2 });

      const response = await json(
        "POST",
        `/api/gitlab-integration/project/${project.id}`,
        { baseUrl: `${gitlab.baseUrl}/forge/`, projectPath: "acme/web" },
      );

      expect(response.status).toBe(200);
      expect(gitlab.calls("GET", "/forge/api/v4/user")[0]?.headers).toMatchObject(
        { "private-token": "saved-secret" },
      );
    });

    it("uses only the freshly supplied token for a changed destination", async () => {
      const { project } = await savedIntegration();

      const response = await json(
        "POST",
        `/api/gitlab-integration/project/${project.id}`,
        {
          baseUrl: gitlab.baseUrl,
          accessToken: "new-token",
          projectPath: "acme/web",
        },
      );

      expect(response.status).toBe(200);
      expect(gitlab.calls("GET", "/api/v4/user")[0]?.headers).toMatchObject({
        "private-token": "new-token",
      });
    });
  });

  describe("get secrets", () => {
    async function withIntegration(role: string) {
      const context = await setup(role);
      await insertRow(app.db, IntegrationEntity, {
        projectId: context.project.id,
        type: "gitlab",
        isActive: true,
        config: JSON.stringify({
          baseUrl: "https://gitlab.com",
          accessToken: "glpat-abcdefghijklmnop",
          projectPath: "acme/web",
          webhookSecret: "webhook-secret",
        }),
      });
      return context;
    }

    it("returns no token hint or webhook secret to other members", async () => {
      const { project } = await withIntegration("member");
      const response = await json(
        "GET",
        `/api/gitlab-integration/project/${project.id}`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        maskedAccessToken: "",
        webhookSecret: "",
        tokenType: "private",
        branchPattern: "{slug}-{number}",
        commentTaskLinkOnGitlabIssue: true,
      });
    });

    it("returns the token hint and webhook secret to settings managers", async () => {
      const { project } = await withIntegration("owner");
      const response = await json(
        "GET",
        `/api/gitlab-integration/project/${project.id}`,
      );
      expect(await response.json()).toMatchObject({
        maskedAccessToken: "glpa••••••mnop",
        webhookSecret: "webhook-secret",
      });
    });

    it("answers null without an integration", async () => {
      const { project } = await setup();
      const response = await json(
        "GET",
        `/api/gitlab-integration/project/${project.id}`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toBeNull();
    });
  });

  describe("update and delete", () => {
    it("updates the comment setting, deactivates and deletes", async () => {
      const { project } = await setup();
      await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "gitlab",
        isActive: true,
        config: JSON.stringify({
          baseUrl: "https://gitlab.com",
          accessToken: "token",
          projectPath: "acme/web",
        }),
      });
      const published = vi.spyOn(app.get(EventBus), "publish");

      const updated = await json(
        "PATCH",
        `/api/gitlab-integration/project/${project.id}`,
        { isActive: false, commentTaskLinkOnGitlabIssue: false },
      );
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        isActive: false,
        commentTaskLinkOnGitlabIssue: false,
      });
      expect(published).toHaveBeenCalledWith("project.updated", {
        projectId: project.id,
        linksChanged: true,
      });

      const deleted = await json(
        "DELETE",
        `/api/gitlab-integration/project/${project.id}`,
      );
      expect(await deleted.json()).toEqual({
        success: true,
        message: "GitLab integration deleted",
      });
      const missing = await json(
        "DELETE",
        `/api/gitlab-integration/project/${project.id}`,
      );
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({
        message: "GitLab integration not found",
      });
    });

    it("refuses settings changes from members without manage_settings", async () => {
      const { project } = await setup("member");
      const response = await json(
        "PATCH",
        `/api/gitlab-integration/project/${project.id}`,
        { isActive: false },
      );
      expect(response.status).toBe(403);
    });
  });

  describe("list projects", () => {
    it("reports a rejected GitLab token as an integration auth failure", async () => {
      const { project } = await setup();
      gitlab.on("GET", "/api/v4/user", () => ({
        status: 401,
        body: { message: "401 Unauthorized" },
      }));

      const response = await json("POST", "/api/gitlab-integration/projects", {
        projectId: project.id,
        baseUrl: gitlab.baseUrl,
        accessToken: "token",
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "INTEGRATION_AUTH_FAILED",
        message: "Invalid GitLab token or could not reach instance.",
      });
    });

    it("lists the member projects", async () => {
      const { project } = await setup();
      gitlab.on("GET", "/api/v4/projects", [
        {
          id: 2,
          name: "web",
          path_with_namespace: "acme/web",
          name_with_namespace: "Acme / web",
          visibility: "private",
          web_url: "https://gitlab.com/acme/web",
          extra: true,
        },
      ]);

      const response = await json("POST", "/api/gitlab-integration/projects", {
        projectId: project.id,
        baseUrl: gitlab.baseUrl,
        accessToken: "token",
      });

      expect(await response.json()).toEqual({
        projects: [
          {
            id: 2,
            name: "web",
            path_with_namespace: "acme/web",
            name_with_namespace: "Acme / web",
            visibility: "private",
            web_url: "https://gitlab.com/acme/web",
          },
        ],
      });
    });
  });

  describe("verify", () => {
    const verify = (projectId: string, body: Record<string, unknown>) =>
      json("POST", "/api/gitlab-integration/verify", {
        projectId,
        accessToken: "token",
        tokenType: "private",
        ...body,
      });

    it("rejects a base URL with a query string as a bad request", async () => {
      const { project } = await setup();
      const response = await verify(project.id, {
        baseUrl: `${gitlab.baseUrl}/?next=/admin`,
        projectPath: "acme/web",
      });
      expect(response.status).toBe(400);
      expect(gitlab.requests).toHaveLength(0);
    });

    it("rejects a project path without a namespace as a bad request", async () => {
      const { project } = await setup();
      const response = await verify(project.id, {
        baseUrl: gitlab.baseUrl,
        projectPath: "web",
      });
      expect(response.status).toBe(400);
      expect(gitlab.requests).toHaveLength(0);
    });

    it("asks GitLab for the normalized project path", async () => {
      const { project } = await setup();
      const response = await verify(project.id, {
        baseUrl: `${gitlab.baseUrl}/`,
        projectPath: "/acme/web/",
      });
      expect(await response.json()).toEqual({
        isInstalled: true,
        hasRequiredPermissions: true,
        projectExists: true,
        projectVisibility: "private",
        missingPermissions: [],
        message: "Token can access the project.",
        failureReason: null,
      });
      expect(gitlab.requests.at(-1)?.path).toBe(gitlabProjectApi("acme/web"));
    });

    it("reports a project the token cannot reach in the body", async () => {
      const { project } = await setup();
      const response = await verify(project.id, {
        baseUrl: gitlab.baseUrl,
        projectPath: "acme/missing",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        projectExists: false,
        failureReason: "project_not_found",
      });
    });

    it.each([401, 403])(
      "reports GitLab HTTP %i as an integration auth failure",
      async (status) => {
        const { project } = await setup();
        gitlab.on("GET", "/api/v4/user", () => ({
          status,
          body: { message: "nope" },
        }));
        const response = await verify(project.id, {
          baseUrl: gitlab.baseUrl,
          projectPath: "acme/web",
        });
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
          code: "INTEGRATION_AUTH_FAILED",
        });
      },
    );
  });

  describe("import", () => {
    const remoteIssue = {
      id: 10,
      iid: 1,
      title: "Remote title",
      description: "Remote description",
      web_url: "https://gitlab.example/group/project/-/issues/1",
      state: "opened",
      labels: [] as string[],
    };

    async function linkedSetup(actions: string[] = ["create", "update"]) {
      const member = await createWorkspaceMember(app.db, {
        role: "gitlab-importer",
      });
      await addWorkspaceRole(app.db, member.workspace.id, "gitlab-importer", {
        task: actions,
      });
      const { project } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const integration = await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "gitlab",
        isActive: true,
        config: JSON.stringify({
          baseUrl: gitlab.baseUrl,
          projectPath: "group/project",
          accessToken: "fake-test-token",
        }),
      });
      const task = await createTask(app.db, {
        projectId: project.id,
        title: "Local title",
        description: "Local description",
        number: 1,
      });
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: "1",
        url: remoteIssue.web_url,
      });
      app.auth.signIn(member.user);
      const api = gitlabProjectApi("group/project");
      gitlab.on("GET", `${api}/issues`, [remoteIssue]);
      gitlab.on("GET", `${api}/issues/1/notes`, []);
      gitlab.on("GET", `${api}/merge_requests`, []);
      const request = () =>
        json("POST", "/api/gitlab-integration/import-issues", {
          projectId: project.id,
        });
      return { ...member, project, task, integration, request, api };
    }

    it.each([{ actions: ["create"] }, { actions: ["update"] }, { actions: [] }])(
      "rejects incomplete task permissions $actions before calling GitLab",
      async ({ actions }) => {
        const { task, request } = await linkedSetup(actions);
        const response = await request();
        expect(response.status).toBe(403);
        expect(gitlab.requests).toHaveLength(0);
        expect(
          await app.db.findOne(TaskEntity, { where: { id: task.id } }),
        ).toMatchObject({
          title: "Local title",
          description: "Local description",
        });
      },
    );

    it("links an imported merge request through its task link", async () => {
      const { project, task, request, api } = await linkedSetup();
      gitlab.on("GET", `${api}/merge_requests`, [
        {
          iid: 7,
          title: "Unrelated title",
          description: `https://kaneo.example.com/dashboard/workspace/w/project/${project.id}/task/${task.id}`,
          web_url: "https://gitlab.example/group/project/-/merge_requests/7",
          state: "opened",
          source_branch: "unrelated",
        },
      ]);
      expect((await request()).status).toBe(200);
      expect(
        await app.db.findOne(ExternalLinkEntity, {
          where: { resourceType: "pull_request" },
        }),
      ).toMatchObject({ taskId: task.id, externalId: "7" });
    });

    it("allows a custom role with both permissions to refresh an existing task", async () => {
      const { task, request } = await linkedSetup();
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ updated: 1, imported: 0 });
      expect(
        await app.db.findOne(TaskEntity, { where: { id: task.id } }),
      ).toMatchObject({
        title: remoteIssue.title,
        description: remoteIssue.description,
      });
    });

    it("keeps task labels when the GitLab issue has none", async () => {
      const { task, workspace, request } = await linkedSetup();
      await insertRow(app.db, LabelEntity, {
        name: "local",
        color: "#123456",
        taskId: task.id,
        workspaceId: workspace.id,
      });

      const response = await request();

      expect(await response.json()).toMatchObject({ updated: 1 });
      const labels = await app.db.find(LabelEntity, {
        where: { taskId: task.id },
      });
      expect(labels.map((label) => label.name)).toEqual(["local"]);
    });

    it("adds GitLab labels without removing the ones set in Kaneo", async () => {
      const { task, workspace, request, api } = await linkedSetup();
      await insertRow(app.db, LabelEntity, {
        name: "local",
        color: "#123456",
        taskId: task.id,
        workspaceId: workspace.id,
      });
      gitlab.on("GET", `${api}/issues`, [
        { ...remoteIssue, labels: ["bug", "priority:high"] },
      ]);

      await request();

      const labels = await app.db.find(LabelEntity, {
        where: { taskId: task.id },
      });
      expect(labels.map((label) => label.name).sort()).toEqual([
        "bug",
        "local",
      ]);
      expect(
        await app.db.findOne(TaskEntity, { where: { id: task.id } }),
      ).toMatchObject({ priority: "high" });
    });

    it("imports a new issue with its public notes", async () => {
      const { project, request, api } = await linkedSetup();
      await app.db.query(
        `UPDATE project SET last_task_number = 1 WHERE id = $1`,
        [project.id],
      );
      gitlab.on("GET", `${api}/issues`, [
        remoteIssue,
        {
          ...remoteIssue,
          id: 11,
          iid: 2,
          title: "New issue",
          web_url: "https://gitlab.example/group/project/-/issues/2",
        },
        { ...remoteIssue, id: 12, iid: 3, confidential: true },
      ]);
      gitlab.on("GET", `${api}/issues/2/notes`, [
        {
          id: 5,
          body: "Public note",
          system: false,
          author: { id: 1, username: "octocat" },
          created_at: "2026-01-01T00:00:00Z",
        },
        { id: 6, body: "added label", system: true, created_at: "" },
        { id: 7, body: "internal", system: false, internal: true, created_at: "" },
      ]);
      const published = vi.spyOn(app.get(EventBus), "publish");

      const response = await request();

      expect(await response.json()).toEqual({
        imported: 1,
        updated: 1,
        skipped: 1,
      });
      const created = await app.db.findOne(TaskEntity, {
        where: { projectId: project.id, title: "New issue" },
      });
      expect(created).toMatchObject({ status: "to-do", priority: "low" });
      expect(published).toHaveBeenCalledWith(
        "task.created",
        expect.objectContaining({
          taskId: created!.id,
          source: "gitlab-import",
          externalId: "2",
        }),
      );
      const comments = (await app.db.query(
        `SELECT content, external_user_name AS "user", external_url AS url FROM activity WHERE task_id = $1`,
        [created!.id],
      )) as Array<Record<string, string>>;
      expect(comments).toEqual([
        {
          content: "Public note",
          user: "octocat",
          url: "https://gitlab.example/group/project/-/issues/2#note_5",
        },
      ]);
    });
  });
});
