// Ported from tests/api/github-integration/repository-binding.test.ts. The
// previous unit suite mocked the database; this runs against the real one.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { IntegrationEntity } from "../../src/database/entities/integration.entity";
import { GitHubApp } from "../../src/integrations/github/app/github-app";
import type { GitHubDeps } from "../../src/integrations/github/github-deps";
import { GitHubIntegrationService } from "../../src/integrations/github/github-integration.service";
import { listUserRepositories } from "../../src/integrations/github/repositories/list-user-repositories";
import { verifyRepositoryOwner } from "../../src/integrations/github/repositories/verify-repository-owner";
import { findRepositoryIntegrations } from "../../src/integrations/github/webhooks/find-repository-integrations";
import { createProjectFixture } from "../support/fixtures/create-project-fixture";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { createGitHubAppDouble } from "../support/fixtures/github-app-double";
import { githubDepsOf } from "../support/fixtures/github-deps-of";
import { insertGitHubIntegration } from "../support/fixtures/github-fixtures";
import { insertRow } from "../support/fixtures/insert-row";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const double = createGitHubAppDouble();
const m = {
  installation: double.app.octokit.rest.apps.getRepoInstallation,
  listInstallations: double.app.octokit.rest.apps.listInstallations,
  user: double.octokit.rest.users.getById,
  permission: double.octokit.rest.repos.getCollaboratorPermissionLevel,
  repo: double.octokit.rest.repos.get,
  listRepos: double.octokit.rest.apps.listReposAccessibleToInstallation,
};
let app: TestApp;
let deps: GitHubDeps;
let userId: string;
let projectId: string;

const binding = () => ({
  repositoryOwner: "Victim",
  repositoryName: "Private",
  installationId: 10,
  repositoryId: 20,
  verifiedGithubAccountId: "30",
  verifiedByUserId: userId,
});

beforeAll(async () => {
  app = await createTestApp({ overrides: [[GitHubApp, double.provider]] });
  deps = githubDepsOf(app);
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetTestDatabase(app.dataSource);
  double.reset();
  const member = await createWorkspaceMember(app.db, { role: "admin" });
  const { project } = await createProjectFixture(app.db, {
    workspaceId: member.workspace.id,
  });
  userId = member.user.id;
  projectId = project.id;
  await insertRow(app.db, AccountEntity, {
    id: `account-${userId}`,
    userId,
    providerId: "github",
    accountId: "30",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  m.installation.mockResolvedValue({ data: { id: 10 } });
  m.user.mockResolvedValue({ data: { id: 30, login: "verified-login" } });
  m.permission.mockResolvedValue({ data: { permission: "admin" } });
  m.repo.mockResolvedValue({
    data: { id: 20, owner: { login: "Victim" }, name: "Private" },
  });
});

const removeAccount = () =>
  app.db.delete(AccountEntity, { userId, providerId: "github" });
const createIntegration = () =>
  app.get(GitHubIntegrationService).create({
    userId,
    projectId,
    repositoryOwner: "victim",
    repositoryName: "private",
  });
/** Spies list reads of `IntegrationEntity` (the old `integrationTable.findMany`). */
function spyIntegrationLists() {
  const find = vi.spyOn(app.db, "find");
  return {
    calls: () =>
      find.mock.calls.filter(
        ([entity]) => (entity as unknown) === IntegrationEntity,
      ),
    restore: () => find.mockRestore(),
  };
}

describe("GitHub repository linking", () => {
  it("binds the repository to the completed OAuth identity and canonical IDs", async () => {
    expect(
      await verifyRepositoryOwner(deps, userId, "victim", "private"),
    ).toEqual(binding());
    expect(m.permission).toHaveBeenCalledWith({
      owner: "victim",
      repo: "private",
      username: "verified-login",
    });
  });

  it.each(["read", "write", "maintain", "none"])(
    "rejects %s permission without creating a shadow integration",
    async (permission) => {
      m.permission.mockResolvedValue({ data: { permission } });
      await expect(createIntegration()).rejects.toMatchObject({ status: 403 });
      expect(await app.db.find(IntegrationEntity)).toHaveLength(0);
    },
  );

  it("rejects missing linked identity before looking up a repository", async () => {
    await removeAccount();
    await expect(
      verifyRepositoryOwner(deps, userId, "victim", "private"),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(m.installation).not.toHaveBeenCalled();
  });

  it("does not save a null installation after provider failure", async () => {
    m.installation.mockRejectedValueOnce(new Error("private provider error"));
    await expect(createIntegration()).rejects.toMatchObject({ status: 403 });
    expect(await app.db.find(IntegrationEntity)).toHaveLength(0);
  });

  it("does not consult another tenant's integrations when linking", async () => {
    const other = await createWorkspaceMember(app.db, { role: "admin" });
    const { project: otherProject } = await createProjectFixture(app.db, {
      workspaceId: other.workspace.id,
    });
    const foreign = await insertGitHubIntegration(
      app.db,
      otherProject.id,
      binding(),
    );
    const lists = spyIntegrationLists();
    try {
      await createIntegration();
      expect(lists.calls()).toHaveLength(0);
    } finally {
      lists.restore();
    }
    const saved = await app.db.findOne(IntegrationEntity, {
      where: { projectId },
    });
    expect(saved?.id).not.toBe(foreign.id);
    expect(JSON.parse(saved!.config)).toMatchObject(binding());
  });

  it("rejects an unexpected identity response", async () => {
    m.user.mockResolvedValueOnce({ data: { id: 31, login: "somebody-else" } });
    await expect(
      verifyRepositoryOwner(deps, userId, "victim", "private"),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(m.permission).not.toHaveBeenCalled();
  });
});

describe("GitHub webhook binding", () => {
  const source = { repository: { id: 20 }, installation: { id: 10 } };

  it("delivers only to verified bindings for both immutable identifiers", async () => {
    const configs: Array<[string, string]> = [
      ["legitimate", JSON.stringify(binding())],
      [
        "different-installation",
        JSON.stringify({ ...binding(), installationId: 11 }),
      ],
      [
        "same-name-different-repo",
        JSON.stringify({ ...binding(), repositoryId: 21 }),
      ],
      [
        "legacy-name-only",
        JSON.stringify({
          repositoryOwner: "Victim",
          repositoryName: "Private",
          installationId: 10,
        }),
      ],
      [
        "unverified-ids",
        JSON.stringify({
          repositoryOwner: "Victim",
          repositoryName: "Private",
          installationId: 10,
          repositoryId: 20,
        }),
      ],
      ["malformed", "invalid"],
    ];
    const ids = new Map<string, string>();
    for (const [name, config] of configs) {
      const member = await createWorkspaceMember(app.db, { role: "admin" });
      const { project } = await createProjectFixture(app.db, {
        workspaceId: member.workspace.id,
      });
      const row = await insertRow(app.db, IntegrationEntity, {
        projectId: project.id,
        type: "github",
        isActive: true,
        config,
      });
      ids.set(name, row.id);
    }
    const delivered = await findRepositoryIntegrations(app.db, source);
    expect(delivered.map(({ id }) => id)).toEqual([ids.get("legitimate")]);
  });

  it("ignores events without an installation before querying tenant data", async () => {
    await insertGitHubIntegration(app.db, projectId, binding());
    const lists = spyIntegrationLists();
    try {
      expect(
        await findRepositoryIntegrations(app.db, { repository: { id: 20 } }),
      ).toEqual([]);
      expect(lists.calls()).toHaveLength(0);
    } finally {
      lists.restore();
    }
  });
});

describe("authorized bounded repository listing", () => {
  const candidate = (id: number) => ({
    id,
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    private: true,
    owner: { login: "owner", avatar_url: "", type: "User" },
    description: "private description",
    html_url: `https://github.com/owner/repo-${id}`,
    updated_at: "2026-01-01",
  });
  const list = (installationPage: number, repositoryPage: number) =>
    listUserRepositories(deps, userId, { installationPage, repositoryPage });

  beforeEach(() => {
    m.listInstallations.mockResolvedValue({
      data: [{ id: 10, account: { login: "owner" } }],
    });
    m.listRepos.mockResolvedValue({
      data: { repositories: [candidate(20), candidate(21)] },
    });
  });

  it("returns only repositories the caller administers", async () => {
    m.permission.mockImplementation(async ({ repo }: { repo: string }) => ({
      data: { permission: repo === "repo-20" ? "admin" : "read" },
    }));
    const page = await list(1, 1);
    expect(page.repositories.map((repo) => repo.id)).toEqual([20]);
    expect(JSON.stringify(page)).not.toContain("repo-21");
    expect(m.listInstallations).toHaveBeenCalledWith(
      expect.objectContaining({ per_page: 1, page: 1 }),
    );
    expect(m.listRepos).toHaveBeenCalledWith(
      expect.objectContaining({ per_page: 20, page: 1 }),
    );
  });

  it("does not expose an unauthorized installation's metadata", async () => {
    m.permission.mockResolvedValue({ data: { permission: "read" } });
    const page = await list(1, 1);
    expect(page.repositories).toEqual([]);
    expect(page.installations).toEqual([]);
    expect(JSON.stringify(page)).not.toContain("owner");
  });

  it("does not traverse additional pages in the same request", async () => {
    m.listRepos.mockResolvedValue({
      data: {
        repositories: Array.from({ length: 20 }, (_, i) => candidate(i + 1)),
      },
    });
    const page = await list(2, 3);
    expect(m.listInstallations).toHaveBeenCalledTimes(1);
    expect(m.listRepos).toHaveBeenCalledTimes(1);
    expect(m.permission).toHaveBeenCalledTimes(20);
    expect(page.nextPage).toEqual({ installationPage: 2, repositoryPage: 4 });
  });

  it("stops when all installations have been visited", async () => {
    m.listInstallations.mockResolvedValue({ data: [] });
    const page = await list(3, 1);
    expect(page.nextPage).toBeNull();
    expect(m.listRepos).not.toHaveBeenCalled();
  });

  it("rejects unlinked callers before any provider enumeration", async () => {
    await removeAccount();
    await expect(list(1, 1)).rejects.toMatchObject({ status: 403 });
    expect(m.listInstallations).not.toHaveBeenCalled();
  });
});
