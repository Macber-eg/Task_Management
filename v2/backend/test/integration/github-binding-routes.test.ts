import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { LabelEntity } from "../../src/database/entities/label.entity";
import { GitHubApp } from "../../src/integrations/github/app/github-app";

import { handleLabelCreated } from "../../src/integrations/github/webhooks/label-created";
import { createApiKeyPrincipal } from "../support/fixtures/create-api-key-principal";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { insertGitHubIntegration } from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { createTestApp, type TestApp } from "../support/test-app";

// Ported from tests/api-integration/github-binding-routes.test.ts.
describe("GitHub binding HTTP and webhook tenant boundaries", () => {
  const double = createGitHubAppDouble();
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    double.reset();
    double.app.octokit.rest.apps.getRepoInstallation.mockResolvedValue({
      data: { id: 10 },
    });
    double.octokit.rest.users.getById.mockResolvedValue({
      data: { id: 30, login: "admin" },
    });
    double.octokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue(
      { data: { permission: "admin" } },
    );
    double.octokit.rest.repos.get.mockResolvedValue({
      data: { id: 20, owner: { login: "owner" }, name: "repo" },
    });
  });

  async function fixture(role = "admin") {
    const member = await createWorkspaceMember(app.db, { role });
    const { project } = await createProjectFixture(app.db, {
      workspaceId: member.workspace.id,
    });
    return { ...member, project };
  }
  function calls(projectId: string) {
    return [
      [
        `/api/github-integration/project/${projectId}`,
        {
          method: "POST",
          body: JSON.stringify({
            repositoryOwner: "owner",
            repositoryName: "repo",
          }),
        },
      ],
      [
        "/api/github-integration/verify",
        {
          method: "POST",
          body: JSON.stringify({
            projectId,
            repositoryOwner: "owner",
            repositoryName: "repo",
          }),
        },
      ],
      [`/api/github-integration/repositories/${projectId}`, { method: "GET" }],
    ] as const;
  }
  const installationLookups = () =>
    double.app.octokit.rest.apps.getRepoInstallation;

  it("rejects an owner's unrestricted API key before repository provider calls", async () => {
    const owner = await fixture();
    app.auth.signInAs(await createApiKeyPrincipal(app.db, owner.user));
    for (const [url, options] of calls(owner.project.id)) {
      const response = await app.request(url, {
        ...options,
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(403);
    }
    expect(installationLookups()).not.toHaveBeenCalled();
    expect(await app.db.find(IntegrationEntity)).toHaveLength(0);
  });

  it("denies members and foreign-workspace administrators before provider lookup", async () => {
    const member = await fixture("member");
    const outsider = await fixture();
    for (const [user, status] of [
      [member.user, 403],
      [outsider.user, 404],
    ] as const) {
      app.auth.signIn(user);
      for (const [url, options] of calls(member.project.id)) {
        const response = await app.request(url, {
          ...options,
          headers: { "content-type": "application/json" },
        });
        expect(response.status).toBe(status);
      }
    }
    expect(installationLookups()).not.toHaveBeenCalled();
  });

  it("requires a completed OAuth account and permits independently authorized tenant bindings", async () => {
    const owners = [await fixture(), await fixture()];
    const connect = (projectId: string) =>
      app.request(calls(projectId)[0][0], {
        ...calls(projectId)[0][1],
        headers: { "content-type": "application/json" },
      });
    app.auth.signIn(owners[0]!.user);
    expect((await connect(owners[0]!.project.id)).status).toBe(403);
    expect(installationLookups()).not.toHaveBeenCalled();
    for (const owner of owners) {
      await insertRow(app.db, AccountEntity, {
        id: `account-${owner.user.id}`,
        userId: owner.user.id,
        providerId: "github",
        accountId: "30",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      app.auth.signIn(owner.user);
      expect((await connect(owner.project.id)).status).toBe(200);
    }
    const bindings = await app.db.find(IntegrationEntity);
    expect(bindings).toHaveLength(2);
    for (const binding of bindings)
      expect(JSON.parse(binding.config)).toMatchObject({
        repositoryId: 20,
        installationId: 10,
        verifiedGithubAccountId: "30",
      });
    double.octokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue(
      { data: { permission: "read" } },
    );
    const forbidden = await connect(owners[1]!.project.id);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).not.toContain(owners[0]!.workspace.id);
  });

  it("an actual label webhook mutates only a verified matching active tenant", async () => {
    const configs = [
      {
        repositoryId: 20,
        installationId: 10,
        verifiedGithubAccountId: "30",
        verifiedByUserId: "operator",
      },
      { installationId: 10 },
      {
        repositoryId: 21,
        installationId: 10,
        verifiedGithubAccountId: "30",
        verifiedByUserId: "operator",
      },
      {
        repositoryId: 20,
        installationId: 11,
        verifiedGithubAccountId: "30",
        verifiedByUserId: "operator",
      },
    ];
    const tenants = [];
    for (const config of configs) {
      const tenant = await fixture();
      tenants.push(tenant);
      await insertGitHubIntegration(app.db, tenant.project.id, {
        repositoryOwner: "owner",
        repositoryName: "repo",
        ...config,
      });
    }
    const deps = githubDepsOf(app);
    await handleLabelCreated(deps, {
      action: "created",
      label: { name: "Provider label", color: "123456" },
      repository: { id: 20, owner: { login: "owner" }, name: "repo" },
      installation: { id: 10 },
    });
    const labels = await app.db.find(LabelEntity);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      workspaceId: tenants[0]!.workspace.id,
      name: "Provider label",
    });
    await handleLabelCreated(deps, {
      action: "created",
      label: { name: "Missing installation", color: "123456" },
      repository: { id: 20, owner: { login: "owner" }, name: "repo" },
    });
    expect(await app.db.find(LabelEntity)).toHaveLength(1);
  });
});
