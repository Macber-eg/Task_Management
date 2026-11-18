import { vi } from "vitest";
import type { GitHubApp } from "../../../src/integrations/github/app/github-app";

/**
 * Stands in for the GitHub App (`GitHubApp`), as the previous suite's mocked
 * `github-app` module: every client call is a `vi.fn` on `octokit`, and the
 * App-level calls are on `app.octokit`. Nothing reaches github.com.
 */
export function createGitHubAppDouble() {
  const octokit = {
    rest: {
      issues: {
        get: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        createComment: vi.fn(),
        listComments: vi.fn(),
        getLabel: vi.fn(),
        createLabel: vi.fn(),
        addLabels: vi.fn(),
        removeLabel: vi.fn(),
      },
      repos: {
        get: vi.fn(),
        getCollaboratorPermissionLevel: vi.fn(),
      },
      users: { getById: vi.fn() },
      apps: { listReposAccessibleToInstallation: vi.fn() },
    },
    graphql: vi.fn(),
  };
  const app = {
    octokit: {
      rest: {
        apps: { getRepoInstallation: vi.fn(), listInstallations: vi.fn() },
      },
    },
    getInstallationOctokit: vi.fn(async () => octokit),
  };
  const github = {
    configured: true,
    app: vi.fn((_bounded?: boolean) => (github.configured ? app : null)),
    installationOctokit: vi.fn(async () => octokit),
    verifiedInstallationOctokit: vi.fn(async () => octokit),
  };
  const reset = () => {
    github.configured = true;
    for (const group of [
      octokit.rest.issues,
      octokit.rest.repos,
      octokit.rest.users,
      octokit.rest.apps,
      app.octokit.rest.apps,
    ])
      for (const fn of Object.values(group)) fn.mockReset();
    octokit.graphql.mockReset();
    app.getInstallationOctokit.mockReset().mockImplementation(async () => octokit);
    github.app.mockClear();
    github.installationOctokit
      .mockReset()
      .mockImplementation(async () => octokit);
    github.verifiedInstallationOctokit
      .mockReset()
      .mockImplementation(async () => octokit);
  };
  return {
    octokit,
    app,
    github,
    /** The override for `createTestApp`. */
    provider: github as unknown as GitHubApp,
    reset,
  };
}

export type GitHubAppDouble = ReturnType<typeof createGitHubAppDouble>;
