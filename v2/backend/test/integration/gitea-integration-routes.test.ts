import { createHmac } from "node:crypto";
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
import { ProjectEntity } from "../../src/database/entities/project.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { EventBus } from "../../src/events/event-bus";
import { resolveVerificationToken } from "../../src/integrations/gitea/integration/resolve-verification-token";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { addWorkspaceRole } from "../support/fixtures/add-workspace-role";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import {
  type GiteaFakeServer,
  giteaRepoApi,
  startGiteaFakeServer,
} from "../support/fixtures/gitea-fake-server";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/gitea-credential-errors.test.ts,
// gitea-verification.test.ts, gitea-task-numbering.test.ts and
// tests/api/gitea-integration/create-gitea-integration.test.ts, against the
// real routes and a fake Gitea instead of mocked modules.
describe("Gitea integration routes", () => {
  let app: TestApp;
  let gitea: GiteaFakeServer;

  beforeAll(async () => {
    app = await createTestApp();
    gitea = await startGiteaFakeServer();
  });
  afterAll(async () => {
    await gitea.close();
    await app.close();
  });
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    gitea.reset();
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    gitea.on("GET", "/api/v1/user", { id: 1, login: "kaneo" });
    gitea.on("GET", giteaRepoApi("owner", "repo"), {
      name: "repo",
      owner: { login: "owner" },
      html_url: `${gitea.baseUrl}/owner/repo`,
      private: false,
      permissions: { admin: true, push: true, pull: true },
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

  const saveIntegration = (projectId: string, config: unknown) =>
    insertRow(app.db, IntegrationEntity, {
      projectId,
      type: "gitea",
      config: typeof config === "string" ? config : JSON.stringify(config),
    });

  const json = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const authorizations = () =>
    gitea.requests.map((request) => request.headers.authorization);

  describe("Gitea credentials are not Kaneo session credentials", () => {
    it.each(["verify", "repositories"])(
      "returns 400 for invalid upstream credentials on %s, but 401 for a missing session",
      async (endpoint) => {
        gitea.on("GET", "/api/v1/user", () => ({
          status: 401,
          body: { message: "token is required" },
        }));
        const { project } = await setup();
        const request = () =>
          json("POST", `/api/gitea-integration/${endpoint}`, {
            projectId: project.id,
            baseUrl: gitea.baseUrl,
            accessToken: "invalid-secret",
            repositoryOwner: "owner",
            repositoryName: "repo",
          });
        const response = await request();
        expect(response.status).toBe(400);
        const body = await response.text();
        expect(body).toContain("Invalid Gitea token");
        expect(body).not.toContain("invalid-secret");
        gitea.reset();
        app.auth.signOut();
        expect((await request()).status).toBe(401);
        expect(gitea.requests).toHaveLength(0);
      },
    );
  });

  describe("saved Gitea token verification route", () => {
    const verify = (projectId: string, baseUrl = gitea.baseUrl) =>
      json("POST", "/api/gitea-integration/verify", {
        projectId,
        baseUrl,
        repositoryOwner: "owner",
        repositoryName: "repo",
      });

    async function fixture(baseUrl = gitea.baseUrl) {
      const { project } = await setup();
      await saveIntegration(project.id, {
        baseUrl,
        accessToken: "saved-secret",
      });
      return { project };
    }

    it("verifies the saved token without returning it", async () => {
      const { project } = await fixture();
      const response = await verify(project.id);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({
        isInstalled: true,
        hasRequiredPermissions: true,
        repositoryExists: true,
        repositoryPrivate: false,
        missingPermissions: [],
        message: "Token can access the repository.",
        failureReason: null,
      });
      expect(authorizations()).toEqual([
        "token saved-secret",
        "token saved-secret",
      ]);
      expect(body).not.toContain("saved-secret");
    });

    it("rejects another destination before any outbound verification", async () => {
      const { project } = await fixture();
      expect((await verify(project.id, "https://other.example")).status).toBe(
        400,
      );
      expect(gitea.requests).toHaveLength(0);
    });

    it.each([
      "ftp://gitea.example",
      "https://gitea.example?token=secret",
      "https://gitea.example#fragment",
      "https://user:secret@gitea.example",
    ])(
      "rejects invalid submitted URL %s without verification",
      async (baseUrl) => {
        const { project } = await fixture();
        const response = await verify(project.id, baseUrl);
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain("secret");
        expect(gitea.requests).toHaveLength(0);
      },
    );

    it("reports malformed saved configuration without revealing it", async () => {
      const { project } = await fixture("https://user:secret@gitea.example");
      const response = await verify(project.id, "https://gitea.example");
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toContain("Reconnect the integration");
      expect(body).not.toContain("secret");
      expect(gitea.requests).toHaveLength(0);
    });

    it("requires workspace management permission to use stored credentials", async () => {
      const { project } = await fixture();
      const outsider = await createWorkspaceMember(app.db);
      app.auth.signIn(outsider.user);
      expect((await verify(project.id)).status).toBe(404);
      expect(gitea.requests).toHaveLength(0);
    });

    it("uses a saved Gitea token only for its project and unchanged destination", async () => {
      const member = await createWorkspaceMember(app.db);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      await saveIntegration(project.id, {
        baseUrl: "https://gitea.example",
        accessToken: "stored-token",
      });
      const input = {
        projectId: project.id,
        baseUrl: "https://gitea.example/",
      };
      expect(await resolveVerificationToken(app.db, input)).toBe(
        "stored-token",
      );
      await expect(
        resolveVerificationToken(app.db, {
          ...input,
          baseUrl: "https://other.example",
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        resolveVerificationToken(app.db, {
          ...input,
          projectId: "other-project",
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        await resolveVerificationToken(app.db, {
          ...input,
          baseUrl: "https://other.example",
          accessToken: "new-token",
        }),
      ).toBe("new-token");
    });
  });

  describe("gitea reconnect credentials", () => {
    const reconnect = (projectId: string, body: Record<string, unknown>) =>
      json("POST", `/api/gitea-integration/project/${projectId}`, {
        baseUrl: gitea.baseUrl,
        repositoryOwner: "owner",
        repositoryName: "repo",
        ...body,
      });

    async function fixture(config: unknown = undefined) {
      const { project } = await setup();
      await saveIntegration(
        project.id,
        config ?? {
          baseUrl: `${gitea.baseUrl}/`,
          accessToken: "saved-token",
          repositoryOwner: "owner",
          repositoryName: "repo",
          webhookSecret: "existing-secret",
        },
      );
      return project;
    }

    it("rejects a changed destination before sending the saved token", async () => {
      const project = await fixture();
      const response = await reconnect(project.id, {
        baseUrl: "https://attacker.example",
      });
      expect(response.status).toBe(400);
      expect(gitea.requests).toHaveLength(0);
      const stored = await app.db.findOne(IntegrationEntity, {
        where: { projectId: project.id },
      });
      expect(JSON.parse(stored!.config).baseUrl).toBe(`${gitea.baseUrl}/`);
    });

    it("reuses credentials only for the same normalized destination", async () => {
      const project = await fixture();
      const published = vi.spyOn(app.get(EventBus), "publish");
      const response = await reconnect(project.id, {});
      expect(response.status).toBe(200);
      expect(authorizations()[0]).toBe("token saved-token");
      expect(await response.json()).toMatchObject({
        projectId: project.id,
        baseUrl: gitea.baseUrl,
        repositoryOwner: "owner",
        repositoryName: "repo",
        maskedAccessToken: "save••••••oken",
        webhookSecret: "existing-secret",
        webhookUrl: expect.stringMatching(
          /\/gitea-integration\/webhook\/.+$/,
        ),
        branchPattern: "{slug}-{number}",
        commentTaskLinkOnGiteaIssue: true,
        isActive: true,
      });
      expect(published).toHaveBeenCalledWith(
        "integration.sync_rules_changed",
        expect.objectContaining({ projectId: project.id }),
      );
    });

    it("allows a changed destination with an explicitly supplied token", async () => {
      const project = await fixture();
      gitea.on("GET", "/sub/api/v1/user", { id: 1, login: "kaneo" });
      gitea.on("GET", `/sub${giteaRepoApi("owner", "repo")}`, {
        name: "repo",
        owner: { login: "owner" },
        private: true,
      });
      const response = await reconnect(project.id, {
        baseUrl: `${gitea.baseUrl}/sub`,
        accessToken: " new-token ",
      });
      expect(response.status).toBe(200);
      expect(gitea.calls("GET", "/sub/api/v1/user")[0]!.headers.authorization).toBe(
        "token new-token",
      );
    });

    it("rejects invalid saved configuration without contacting a provider", async () => {
      const project = await fixture("{");
      expect((await reconnect(project.id, {})).status).toBe(400);
      expect(gitea.requests).toHaveLength(0);
    });

    it("refuses a repository already linked to another project", async () => {
      const project = await fixture();
      const other = await createProjectFixture(app.db, {
        workspaceId: (await app.db.findOneByOrFail(ProjectEntity, {
          id: project.id,
        })).workspaceId,
      });
      await insertRow(app.db, IntegrationEntity, {
        projectId: other.project.id,
        type: "gitea",
        isActive: true,
        config: JSON.stringify({
          baseUrl: gitea.baseUrl,
          accessToken: "other",
          repositoryOwner: "owner",
          repositoryName: "repo",
        }),
      });
      const response = await reconnect(project.id, {});
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        message:
          "Repository owner/repo on this Gitea instance is already linked to another project",
      });
    });
  });

  describe("integration settings", () => {
    it("shows the webhook secret only to managers, updates settings and unlinks", async () => {
      const { project, workspace } = await setup();
      await saveIntegration(project.id, {
        baseUrl: gitea.baseUrl,
        accessToken: "saved-access-token",
        repositoryOwner: "owner",
        repositoryName: "repo",
        webhookSecret: "hook-secret",
      });
      const read = async () =>
        (await (
          await app.request(`/api/gitea-integration/project/${project.id}`)
        ).json()) as Record<string, unknown>;
      expect(await read()).toMatchObject({
        webhookSecret: "hook-secret",
        maskedAccessToken: "save••••••oken",
      });
      const member = await createWorkspaceMember(app.db);
      await addWorkspaceMember(app.db, workspace.id, member.user.id, "member");
      app.auth.signIn(member.user);
      expect((await read()).webhookSecret).toBe("");
      const denied = await json(
        "PATCH",
        `/api/gitea-integration/project/${project.id}`,
        { isActive: false },
      );
      expect(denied.status).toBe(403);
    });

    it("updates the task-link comment setting and removes the integration", async () => {
      const { project } = await setup();
      await saveIntegration(project.id, {
        baseUrl: gitea.baseUrl,
        accessToken: "saved-access-token",
        repositoryOwner: "owner",
        repositoryName: "repo",
      });
      const published = vi.spyOn(app.get(EventBus), "publish");
      const updated = await json(
        "PATCH",
        `/api/gitea-integration/project/${project.id}`,
        { commentTaskLinkOnGiteaIssue: false, isActive: false },
      );
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        commentTaskLinkOnGiteaIssue: false,
        isActive: false,
      });
      expect(published).toHaveBeenCalledWith("project.updated", {
        projectId: project.id,
        linksChanged: true,
      });
      const removed = await json(
        "DELETE",
        `/api/gitea-integration/project/${project.id}`,
      );
      expect(await removed.json()).toEqual({
        success: true,
        message: "Gitea integration deleted",
      });
      const missing = await json(
        "DELETE",
        `/api/gitea-integration/project/${project.id}`,
      );
      expect(missing.status).toBe(404);
      expect(
        await (
          await app.request(`/api/gitea-integration/project/${project.id}`)
        ).json(),
      ).toBeNull();
    });
  });

  // The Gitea cases of tests/api-integration/integration-import-permissions.test.ts.
  describe("gitea import permissions", () => {
    async function importer(permission: Record<string, string[]>) {
      const member = await createWorkspaceMember(app.db, { role: "importer" });
      await addWorkspaceRole(app.db, member.workspace.id, "importer", permission);
      const { project } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      await saveIntegration(project.id, {
        baseUrl: gitea.baseUrl,
        accessToken: "fake-test-token",
        repositoryOwner: "owner",
        repositoryName: "repo",
      });
      gitea.on("GET", giteaRepoApi("owner", "repo", "/issues"), []);
      gitea.on("GET", giteaRepoApi("owner", "repo", "/pulls"), []);
      app.auth.signIn(member.user);
      return json("POST", "/api/gitea-integration/import-issues", {
        projectId: project.id,
      });
    }
    const listedIssues = () =>
      gitea.calls("GET", giteaRepoApi("owner", "repo", "/issues"));

    it("gitea denies a create-only custom role", async () => {
      const response = await importer({ task: ["create"] });
      expect(response.status).toBe(403);
      expect(listedIssues()).toHaveLength(0);
    });

    it("gitea accepts a custom role with both create and update", async () => {
      const response = await importer({ task: ["create", "update"] });
      expect(response.status).toBe(200);
      expect(listedIssues()).toHaveLength(1);
    });
  });

  describe("Gitea import task numbers", () => {
    async function importFixture() {
      const { project } = await setup();
      await saveIntegration(project.id, {
        baseUrl: gitea.baseUrl,
        accessToken: "fake-local-token",
        repositoryOwner: "owner",
        repositoryName: "repo",
      });
      gitea.on("GET", giteaRepoApi("owner", "repo", "/issues"), [
        {
          id: 1,
          number: 1,
          title: "Imported issue",
          body: "Body",
          state: "open",
          labels: [],
          html_url: `${gitea.baseUrl}/owner/repo/issues/1`,
        },
      ]);
      gitea.on("GET", giteaRepoApi("owner", "repo", "/pulls"), []);
      gitea.on("GET", giteaRepoApi("owner", "repo", "/issues/1/comments"), []);
      return project;
    }

    const importIssues = async (projectId: string) => {
      const response = await json(
        "POST",
        "/api/gitea-integration/import-issues",
        { projectId },
      );
      expect(response.status).toBe(200);
      return response.json();
    };

    const createKaneoTask = async (projectId: string, title: string) => {
      const response = await json("POST", `/api/task/${projectId}`, {
        title,
        description: "",
        priority: "low",
        status: "to-do",
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { number: number };
    };

    const lastTaskNumber = async (projectId: string) =>
      (await app.db.findOneByOrFail(ProjectEntity, { id: projectId }))
        .lastTaskNumber;

    it("advances the shared counter before a normal task is created", async () => {
      const project = await importFixture();
      expect(await importIssues(project.id)).toMatchObject({ imported: 1 });
      expect((await createKaneoTask(project.id, "Next")).number).toBe(2);
      expect(await lastTaskNumber(project.id)).toBe(2);
    });

    it("serializes import and concurrent ordinary creation through one counter", async () => {
      const project = await importFixture();
      const [imported] = await Promise.all([
        importIssues(project.id),
        ...Array.from({ length: 3 }, (_, index) =>
          createKaneoTask(project.id, `Concurrent ${index}`),
        ),
      ]);
      expect(imported).toMatchObject({ imported: 1 });
      const tasks = await app.db.find(TaskEntity);
      expect(tasks.map((task) => task.number).sort()).toEqual([1, 2, 3, 4]);
    });

    // The previous backend's counter repair (drizzle 0046) is part of the
    // baseline schema here; its statement is replayed to keep the case.
    const repair = `UPDATE "project" AS p
      SET "last_task_number" = greatest(p."last_task_number", counts.max_number)
      FROM (SELECT "project_id", max("number") AS max_number FROM "task" GROUP BY "project_id") AS counts
      WHERE p."id" = counts."project_id" AND p."last_task_number" < counts.max_number`;

    it("repairs a legacy counter without renumbering existing references, and is idempotent", async () => {
      const project = await importFixture();
      await createTask(app.db, {
        projectId: project.id,
        title: "Legacy import",
        number: 42,
      });
      await createTask(app.db, {
        projectId: project.id,
        title: "Earlier task",
        number: 41,
      });
      await app.db.query(repair);
      await app.db.query(repair);
      expect((await createKaneoTask(project.id, "After upgrade")).number).toBe(
        43,
      );
      const tasks = await app.db.find(TaskEntity);
      expect(tasks.map((row) => row.number).sort()).toEqual([41, 42, 43]);
    });

    it("never lowers a high-water counter when the highest task was deleted", async () => {
      const project = await importFixture();
      await app.db.update(
        ProjectEntity,
        { id: project.id },
        { lastTaskNumber: 100 },
      );
      await createTask(app.db, {
        projectId: project.id,
        title: "Older task",
        number: 1,
      });
      await app.db.query(repair);
      expect(await importIssues(project.id)).toMatchObject({ imported: 1 });
      expect(await lastTaskNumber(project.id)).toBe(101);
    });
  });

  describe("webhook route", () => {
    const deliver = (
      integrationId: string,
      payload: unknown,
      { secret, event = "issue_comment" }: { secret?: string; event?: string },
    ) => {
      const body = JSON.stringify(payload);
      return app.request(`/api/gitea-integration/webhook/${integrationId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gitea-Event": event,
          ...(secret
            ? {
                "X-Gitea-Signature": createHmac("sha256", secret)
                  .update(body)
                  .digest("hex"),
              }
            : {}),
        },
        body,
      });
    };

    async function linked() {
      const { project } = await setup();
      app.auth.signOut();
      const integration = await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "gitea",
        isActive: true,
        config: JSON.stringify({
          baseUrl: "https://gitea.example",
          accessToken: "token",
          repositoryOwner: "owner",
          repositoryName: "repo",
          webhookSecret: "hook-secret",
        }),
      });
      const task = await createTask(app.db, {
        projectId: project.id,
        title: "Linked",
        number: 1,
      });
      await insertRow(app.db, ExternalLinkEntity, {
        taskId: task.id,
        integrationId: integration.id,
        resourceType: "issue",
        externalId: "42",
        url: "https://gitea.example/owner/repo/issues/42",
      });
      return { integration, task };
    }

    const commentPayload = {
      action: "created",
      issue: { number: 42 },
      comment: {
        id: 7,
        body: "Written in Gitea",
        html_url: "https://gitea.example/owner/repo/issues/42#issuecomment-7",
        user: { login: "someone", avatar_url: "https://avatar" },
        created_at: "2026-01-01T00:00:00Z",
      },
      repository: {
        owner: { login: "owner" },
        name: "repo",
        html_url: "https://gitea.example/owner/repo",
      },
    };

    it("accepts a signed delivery without a session and records the comment", async () => {
      const { integration, task } = await linked();
      const response = await deliver(integration.id, commentPayload, {
        secret: "hook-secret",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "success" });
      expect(
        await app.db.find(ActivityEntity, { where: { taskId: task.id } }),
      ).toEqual([
        expect.objectContaining({
          type: "comment",
          content: "Written in Gitea",
          externalUserName: "someone",
          externalSource: "gitea",
        }),
      ]);
    });

    it.each([
      [undefined, "Invalid webhook signature"],
      ["wrong-secret", "Invalid webhook signature"],
    ])(
      "rejects a delivery signed with %s",
      async (secret, error) => {
        const { integration, task } = await linked();
        const response = await deliver(integration.id, commentPayload, {
          secret,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error });
        expect(
          await app.db.find(ActivityEntity, { where: { taskId: task.id } }),
        ).toEqual([]);
      },
    );

    it("rejects unknown integrations and missing event names", async () => {
      const { integration } = await linked();
      const unknown = await deliver("missing", commentPayload, {
        secret: "hook-secret",
      });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual({
        error: "Gitea integration not found",
      });
      const noEvent = await deliver(integration.id, commentPayload, {
        secret: "hook-secret",
        event: "",
      });
      expect(await noEvent.json()).toEqual({ error: "Missing event name" });
    });
  });
});
