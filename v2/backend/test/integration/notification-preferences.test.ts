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
import { UserNotificationPreferenceEntity } from "../../src/database/entities/user-notification-preference.entity";
import { UserNotificationWorkspaceProjectEntity } from "../../src/database/entities/user-notification-workspace-project.entity";
import { UserNotificationWorkspaceRuleEntity } from "../../src/database/entities/user-notification-workspace-rule.entity";
import { decryptSecret } from "../../src/notification-preferences/secrets";
import { createMember } from "../support/fixtures/create-member";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createRestrictedWorkspace } from "../support/fixtures/create-restricted-workspace";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { restrictToProjects } from "../support/fixtures/restrict-to-projects";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

type Preferences = {
  workspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    emailEnabled: boolean;
    ntfyEnabled: boolean;
    gotifyEnabled: boolean;
    webhookEnabled: boolean;
    projectMode: string;
    selectedProjectIds: string[];
  }>;
} & Record<string, unknown>;

describe("API integration: notification preferences", () => {
  let app: TestApp;

  function json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  const rule = (overrides: Record<string, unknown> = {}) => ({
    isActive: true,
    emailEnabled: false,
    ntfyEnabled: false,
    gotifyEnabled: false,
    webhookEnabled: false,
    projectMode: "all",
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "notification-test-key");
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    await resetTestDatabase(app.dataSource);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Ported from the previous project access management suite.
  describe("notification rules with project access", () => {
    it("keeps projects a member lost when they save the rule again", async () => {
      const ctx = await createRestrictedWorkspace(app.db);
      const member = await createMember(app.db, ctx.workspace.id);
      app.auth.signIn(member);
      const saveRule = (projectIds: string[]) =>
        app.request(
          `/api/notification-preferences/workspaces/${ctx.workspace.id}`,
          json(
            "PUT",
            rule({ projectMode: "selected", selectedProjectIds: projectIds }),
          ),
        );

      expect((await saveRule([ctx.alpha.id, ctx.beta.id])).status).toBe(200);
      await restrictToProjects(app.db, ctx.workspace.id, member.id, [
        ctx.alpha.id,
      ]);

      const read = await app.request("/api/notification-preferences");
      const preferences = (await read.json()) as Preferences;
      expect(preferences.workspaces[0]?.selectedProjectIds).toEqual([
        ctx.alpha.id,
      ]);

      expect((await saveRule([])).status).toBe(200);
      const stored = await app.db.find(UserNotificationWorkspaceProjectEntity);
      expect(stored.map((row) => row.projectId)).toEqual([ctx.beta.id]);
    });
  });

  it("answers the defaults for a user without preferences", async () => {
    const { user } = await createWorkspaceMember(app.db);
    app.auth.signIn(user);

    const response = await app.request("/api/notification-preferences");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      emailAddress: user.email,
      emailEnabled: false,
      ntfyEnabled: false,
      ntfyConfigured: false,
      ntfyServerUrl: null,
      ntfyTopic: null,
      ntfyTokenConfigured: false,
      maskedNtfyToken: null,
      gotifyEnabled: false,
      gotifyConfigured: false,
      gotifyServerUrl: null,
      gotifyTokenConfigured: false,
      maskedGotifyToken: null,
      webhookEnabled: false,
      webhookConfigured: false,
      webhookUrl: null,
      webhookSecretConfigured: false,
      maskedWebhookSecret: null,
      taskAssignmentEnabled: true,
      taskCommentEnabled: true,
      taskStatusChangeEnabled: true,
      dueDateReminderEnabled: true,
      dueDateReminderLeadTimeMinutes: 1440,
      workspaces: [],
      createdAt: null,
      updatedAt: null,
    });
  });

  it("stores secrets encrypted and reports them masked", async () => {
    const { user } = await createWorkspaceMember(app.db);
    app.auth.signIn(user);

    const response = await app.request(
      "/api/notification-preferences",
      json("PUT", {
        gotifyEnabled: true,
        gotifyServerUrl: " https://gotify.example ",
        gotifyToken: "gotify-app-token",
        webhookEnabled: true,
        webhookUrl: "https://hooks.example/kaneo",
        webhookSecret: "short",
        dueDateReminderLeadTimeMinutes: 60,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      gotifyEnabled: true,
      gotifyConfigured: true,
      gotifyServerUrl: "https://gotify.example",
      gotifyTokenConfigured: true,
      maskedGotifyToken: "goti…oken",
      webhookConfigured: true,
      webhookSecretConfigured: true,
      maskedWebhookSecret: "••••",
      dueDateReminderLeadTimeMinutes: 60,
    });
    const stored = await app.db.findOneByOrFail(
      UserNotificationPreferenceEntity,
      { userId: user.id },
    );
    expect(stored.gotifyToken).toMatch(/^enc:v1:/);
    expect(decryptSecret(stored.gotifyToken)).toBe("gotify-app-token");
    expect(decryptSecret(stored.webhookSecret)).toBe("short");

    // Omitting a secret keeps it; null clears it.
    const cleared = await app.request(
      "/api/notification-preferences",
      json("PUT", { webhookSecret: null }),
    );
    expect(await cleared.json()).toMatchObject({
      gotifyTokenConfigured: true,
      webhookSecretConfigured: false,
      maskedWebhookSecret: null,
    });
  });

  it("rejects unusable channel settings", async () => {
    const { user } = await createWorkspaceMember(app.db);
    app.auth.signIn(user);
    const put = async (body: unknown) => {
      const response = await app.request(
        "/api/notification-preferences",
        json("PUT", body),
      );
      expect(response.status).toBe(400);
      return (await readErrorBody(response)).message;
    };

    expect(await put({ ntfyEnabled: true })).toBe(
      "ntfy requires a server URL and topic",
    );
    expect(await put({ gotifyEnabled: true, gotifyServerUrl: "x" })).toBe(
      "Gotify requires a server URL and app token",
    );
    expect(await put({ webhookEnabled: true })).toBe(
      "Webhook notifications require an endpoint URL",
    );
    expect(await put({ webhookUrl: "ftp://hooks.example" })).toBe(
      "Generic webhook URL must use http or https",
    );
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "false");
    expect(await put({ webhookUrl: "http://127.0.0.1/hook" })).toBe(
      "Generic webhook destination resolves to a non-routable address",
    );
    expect(await put({ dueDateReminderLeadTimeMinutes: 1 })).toBeDefined();
    expect(
      await app.db.count(UserNotificationPreferenceEntity),
    ).toBe(0);
  });

  it("refuses email without an account address (API keys carry none)", async () => {
    const { user } = await createWorkspaceMember(app.db);
    app.auth.signInAs({
      userId: user.id,
      userEmail: "",
      user: null,
      session: null,
      apiKey: { id: "key", userId: user.id, enabled: true, permissions: null },
    });

    const response = await app.request(
      "/api/notification-preferences",
      json("PUT", { emailEnabled: true }),
    );

    expect(response.status).toBe(400);
    expect((await readErrorBody(response)).message).toBe(
      "Email notifications require an account email address",
    );
  });

  it("requires global channels before a workspace rule uses them, and cascades changes", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    app.auth.signIn(user);
    const path = `/api/notification-preferences/workspaces/${workspace.id}`;

    const early = await app.request(path, json("PUT", rule({ emailEnabled: true })));
    expect(early.status).toBe(400);
    expect((await readErrorBody(early)).message).toBe(
      "Enable email notifications globally before using them here",
    );

    await app.request(
      "/api/notification-preferences",
      json("PUT", { emailEnabled: true }),
    );
    const saved = await app.request(
      path,
      json("PUT", rule({ emailEnabled: true })),
    );
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as Preferences).workspaces).toEqual([
      expect.objectContaining({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        emailEnabled: true,
        projectMode: "all",
        selectedProjectIds: [],
      }),
    ]);

    // Turning on a channel globally turns it on in active rules.
    const gotify = await app.request(
      "/api/notification-preferences",
      json("PUT", {
        gotifyEnabled: true,
        gotifyServerUrl: "https://gotify.example",
        gotifyToken: "token",
      }),
    );
    expect(
      ((await gotify.json()) as Preferences).workspaces[0],
    ).toMatchObject({ emailEnabled: true, gotifyEnabled: true });

    // Turning email off globally turns it off in every active rule.
    const off = await app.request(
      "/api/notification-preferences",
      json("PUT", { emailEnabled: false }),
    );
    expect(((await off.json()) as Preferences).workspaces[0]).toMatchObject({
      emailEnabled: false,
      gotifyEnabled: true,
    });
  });

  it("validates selected projects and answers 403 outside the workspace", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { workspace: foreign } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    const { project: foreignProject } = await createProjectFixture(app.db, {
      workspaceId: foreign.id,
    });
    app.auth.signIn(user);
    const path = `/api/notification-preferences/workspaces/${workspace.id}`;

    const empty = await app.request(
      path,
      json("PUT", rule({ projectMode: "selected", selectedProjectIds: [] })),
    );
    expect((await readErrorBody(empty)).message).toBe(
      "Select at least one project for selected project mode",
    );
    const invalid = await app.request(
      path,
      json(
        "PUT",
        rule({
          projectMode: "selected",
          selectedProjectIds: [project.id, foreignProject.id],
        }),
      ),
    );
    expect(invalid.status).toBe(400);
    expect((await readErrorBody(invalid)).message).toBe(
      "One or more selected projects are invalid",
    );

    for (const method of ["PUT", "DELETE"]) {
      const response = await app.request(
        `/api/notification-preferences/workspaces/${foreign.id}`,
        json(method, rule()),
      );
      expect(response.status).toBe(403);
      expect((await readErrorBody(response)).message).toBe(
        "You don't have access to this workspace",
      );
    }
  });

  it("deletes a workspace rule and answers 404 when there is none", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const { project } = await createProjectFixture(app.db, {
      workspaceId: workspace.id,
    });
    app.auth.signIn(user);
    const path = `/api/notification-preferences/workspaces/${workspace.id}`;
    await app.request(
      path,
      json(
        "PUT",
        rule({ projectMode: "selected", selectedProjectIds: [project.id] }),
      ),
    );

    const deleted = await app.request(path, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as Preferences).workspaces).toEqual([]);
    expect(await app.db.count(UserNotificationWorkspaceRuleEntity)).toBe(0);
    expect(await app.db.count(UserNotificationWorkspaceProjectEntity)).toBe(0);

    const missing = await app.request(path, { method: "DELETE" });
    expect(missing.status).toBe(404);
    expect(await readErrorBody(missing)).toEqual({
      message: "Workspace notification rule not found",
      code: "NOT_FOUND",
    });
  });

  it("reads a secret the previous backend encrypted", async () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "legacy-backend-key");
    const { user } = await createWorkspaceMember(app.db);
    await insertRow(app.db, UserNotificationPreferenceEntity, {
      userId: user.id,
      gotifyEnabled: true,
      gotifyServerUrl: "https://gotify.example",
      gotifyToken:
        "enc:v1:L3VbgECMHhjDFsJ6.K21F68fK3t-VMsCVjJjMLA.fTof1eZ_KlxjhGWZSBG07xFAUQ",
    });
    app.auth.signIn(user);

    const response = await app.request("/api/notification-preferences");

    expect(await response.json()).toMatchObject({
      gotifyConfigured: true,
      maskedGotifyToken: "goti…oken",
    });
  });
});
