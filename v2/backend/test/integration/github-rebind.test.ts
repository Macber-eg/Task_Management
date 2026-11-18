// Ported from tests/api-integration/github-rebind.test.ts.
import { createId } from "@paralleldrive/cuid2";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { ExternalLinkEntity } from "../../src/database/entities/external-link.entity";
import { GithubImportEntity } from "../../src/database/entities/github-import.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { TaskEntity } from "../../src/database/entities/task.entity";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import { GitHubIntegrationService } from "../../src/integrations/github/github-integration.service";
import { initialImportState } from "../../src/integrations/github/import/import-state";
import type { RepositoryBinding } from "../../src/integrations/github/repositories/verify-repository-owner";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createTask } from "../support/fixtures/create-task";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertGitHubIntegration } from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("GitHub repository changes preserve link ownership", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    double.reset();
  });

  /**
   * The previous suite mocked `verifyRepositoryOwner`; here the GitHub App
   * double answers so that the real verification returns `binding`.
   */
  function verify(binding: Omit<RepositoryBinding, "verifiedByUserId">) {
    double.app.octokit.rest.apps.getRepoInstallation.mockResolvedValue({
      data: { id: binding.installationId },
    });
    double.octokit.rest.users.getById.mockResolvedValue({
      data: { id: Number(binding.verifiedGithubAccountId), login: "admin" },
    });
    double.octokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue(
      { data: { permission: "admin" } },
    );
    double.octokit.rest.repos.get.mockResolvedValue({
      data: {
        id: binding.repositoryId,
        owner: { login: binding.repositoryOwner },
        name: binding.repositoryName,
      },
    });
  }

  async function setup() {
    const member = await createWorkspaceMember(app.db, { role: "admin" });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    await insertRow(app.db, AccountEntity, {
      id: `account-${member.user.id}`,
      userId: member.user.id,
      providerId: "github",
      accountId: "3",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const config = {
      repositoryOwner: "owner",
      repositoryName: "repo",
      installationId: 1,
      repositoryId: 2,
      verifiedGithubAccountId: "3",
      verifiedByUserId: member.user.id,
      branchPattern: "feature/{slug}-{number}",
      commentTaskLinkOnGitHubIssue: false,
    };
    const integration = await insertGitHubIntegration(
      app.db,
      project.id,
      config,
    );
    const task = await createTask(app.db, {
      projectId: project.id,
      title: "Existing task",
      number: 1,
    });
    const link = await insertRow(app.db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "1",
      url: "https://github.com/owner/repo/issues/1",
    });
    await insertRow(app.db, GithubImportEntity, {
      integrationId: integration.id,
      runId: createId(),
      state: initialImportState(2),
    });
    verify(config);
    const service = app.get(GitHubIntegrationService);
    const connect = () =>
      service.create({
        userId: member.user.id,
        projectId: project.id,
        repositoryOwner: "owner",
        repositoryName: "repo",
      });
    app.auth.signIn(member.user);
    return { project, config, integration, task, link, connect, service };
  }
  const firstIntegration = async () => (await app.db.find(IntegrationEntity))[0];
  const firstLink = async () => (await app.db.find(ExternalLinkEntity))[0];

  it("rejects a different numeric repository even when its name is identical", async () => {
    const { integration, config, link, connect } = await setup();
    verify({ ...config, repositoryId: 99 });
    await expect(connect()).rejects.toMatchObject({ status: 409 });
    expect(await firstIntegration()).toMatchObject({
      id: integration.id,
      config: integration.config,
    });
    expect(await firstLink()).toMatchObject(link);
    expect(await app.db.find(GithubImportEntity)).toHaveLength(1);
  });

  it("preserves links, pending imports and settings when the same repository is renamed or reinstalled", async () => {
    const { config, integration, link, connect } = await setup();
    verify({
      repositoryOwner: "new-owner",
      repositoryName: "renamed",
      repositoryId: 2,
      installationId: 88,
      verifiedGithubAccountId: "3",
    });
    expect(await connect()).toMatchObject({
      id: integration.id,
      repositoryName: "renamed",
      installationId: 88,
    });
    expect(
      JSON.parse((await firstIntegration())?.config ?? "{}"),
    ).toMatchObject({
      branchPattern: config.branchPattern,
      commentTaskLinkOnGitHubIssue: false,
      repositoryId: 2,
    });
    expect(await firstLink()).toMatchObject(link);
    expect(await app.db.find(GithubImportEntity)).toHaveLength(1);
  });

  it("allows administrator reverification of a matching legacy name, but requires disconnect for a different name", async () => {
    const { config, integration, connect } = await setup();
    const legacy = {
      repositoryOwner: "OWNER",
      repositoryName: "REPO",
      installationId: 1,
    };
    await app.db.update(
      IntegrationEntity,
      { id: integration.id },
      { config: JSON.stringify(legacy) },
    );
    verify({ ...config, repositoryName: "another" });
    await expect(connect()).rejects.toMatchObject({ status: 409 });
    verify(config);
    await expect(connect()).resolves.toMatchObject({ id: integration.id });
  });

  it("requires an explicit disconnect when an existing configuration cannot establish repository identity", async () => {
    const { integration, connect } = await setup();
    await app.db.update(
      IntegrationEntity,
      { id: integration.id },
      { config: "invalid" },
    );
    await expect(connect()).rejects.toMatchObject({ status: 409 });
    expect(await firstLink()).toBeDefined();
  });

  it("permits switching after disconnect without reusing old links or import cursors", async () => {
    const { project, config, integration, task, connect, service } =
      await setup();
    await service.delete(project.id);
    verify({ ...config, repositoryId: 99, repositoryName: "other" });
    const next = await connect();
    expect(next.id).not.toBe(integration.id);
    expect(await app.db.find(ExternalLinkEntity)).toHaveLength(0);
    expect(await app.db.find(GithubImportEntity)).toHaveLength(0);
    expect((await app.db.find(TaskEntity))[0]).toMatchObject({ id: task.id });
  });

  it.each(["reconnect", "settings"])(
    "rejects a concurrent repository change during %s instead of overwriting the new binding",
    async (operation) => {
      const { project, config, integration, connect } = await setup();
      const nextConfig = JSON.stringify({
        ...config,
        repositoryId: 99,
        repositoryName: "new",
      });
      // The previous suite intercepted the integration read; here the same
      // read through the shared entity manager changes the row after it.
      const findOne = app.db.findOne.bind(app.db);
      let intercepted = false;
      const spy = vi
        .spyOn(app.db, "findOne")
        .mockImplementation(async (entity, options) => {
          const row = await findOne(entity, options);
          if (entity === IntegrationEntity && !intercepted) {
            intercepted = true;
            await app.db.update(
              IntegrationEntity,
              { id: integration.id },
              { config: nextConfig },
            );
          }
          return row;
        });
      try {
        if (operation === "reconnect")
          await expect(connect()).rejects.toMatchObject({ status: 409 });
        else {
          const response = await app.request(
            `/api/github-integration/project/${project.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commentTaskLinkOnGitHubIssue: true }),
            },
          );
          expect(response.status).toBe(409);
        }
      } finally {
        spy.mockRestore();
      }
      expect(intercepted).toBe(true);
      expect((await firstIntegration())?.config).toBe(nextConfig);
    },
  );
});
