// Ported from tests/api/github-integration/verify-github-installation.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GitHubApp } from "../app/github-app";
import { verifyGithubInstallation as verify } from "./verify-github-installation";

const mockGetRepoInstallation = vi.fn();
const mockReposGet = vi.fn();
const mockGetInstallationOctokit = vi.fn();

const mockApp = {
  octokit: {
    rest: {
      apps: {
        getRepoInstallation: (...args: unknown[]) =>
          mockGetRepoInstallation(...args),
      },
      repos: {
        get: (...args: unknown[]) => mockReposGet(...args),
      },
    },
  },
  getInstallationOctokit: (...args: unknown[]) =>
    mockGetInstallationOctokit(...args),
};

const mockGetGithubApp = vi.fn<() => typeof mockApp | null>(() => mockApp);
// The previous suite mocked `getGithubApp`; the App is now passed in.
const github = { app: () => mockGetGithubApp() } as unknown as GitHubApp;
const verifyGithubInstallation = (repository: {
  repositoryOwner: string;
  repositoryName: string;
}) => verify(github, repository);

function makeInstallationOctokit() {
  return {
    rest: {
      repos: {
        get: (...args: unknown[]) => mockReposGet(...args),
      },
    },
  };
}

const originalAppName = process.env.GITHUB_APP_NAME;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGithubApp.mockReturnValue(mockApp);
  process.env.GITHUB_APP_NAME = "kaneo-app";
});

afterEach(() => {
  if (originalAppName === undefined) {
    delete process.env.GITHUB_APP_NAME;
  } else {
    process.env.GITHUB_APP_NAME = originalAppName;
  }
});

describe("verifyGithubInstallation", () => {
  it("throws HTTP 500 when the GitHub App is not configured", async () => {
    mockGetGithubApp.mockReturnValueOnce(null);

    await expect(
      verifyGithubInstallation({
        repositoryOwner: "usekaneo",
        repositoryName: "kaneo",
      }),
    ).rejects.toMatchObject({
      status: 500,
    });

    expect(mockGetRepoInstallation).not.toHaveBeenCalled();
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  it("returns success when installation is found and has required permissions", async () => {
    mockGetRepoInstallation.mockResolvedValue({
      data: {
        id: 4242,
        permissions: { issues: "write", metadata: "read" },
      },
    });
    mockGetInstallationOctokit.mockResolvedValue(makeInstallationOctokit());
    mockReposGet.mockResolvedValue({
      data: { id: 99, private: false, owner: { id: 555, login: "usekaneo" } },
    });

    const result = await verifyGithubInstallation({
      repositoryOwner: "usekaneo",
      repositoryName: "kaneo",
    });

    expect(result).toEqual({
      isInstalled: true,
      installationId: 4242,
      repositoryExists: true,
      repositoryPrivate: false,
      permissions: { issues: "write", metadata: "read" },
      hasRequiredPermissions: true,
      missingPermissions: [],
      message:
        "GitHub App is properly installed and has all required permissions",
      settingsUrl: "https://github.com/settings/installations/4242",
      installationUrl:
        "https://github.com/apps/kaneo-app/installations/new/permissions?target_id=555",
    });

    expect(mockGetRepoInstallation).toHaveBeenCalledWith({
      owner: "usekaneo",
      repo: "kaneo",
    });
    expect(mockGetInstallationOctokit).toHaveBeenCalledWith(4242);
    expect(mockReposGet).toHaveBeenCalledTimes(1);
    expect(mockReposGet).toHaveBeenCalledWith({
      owner: "usekaneo",
      repo: "kaneo",
    });
  });

  it("reports missing permissions without surfacing an error", async () => {
    mockGetRepoInstallation.mockResolvedValue({
      data: {
        id: 7777,
        permissions: { metadata: "read" },
      },
    });
    mockGetInstallationOctokit.mockResolvedValue(makeInstallationOctokit());
    mockReposGet.mockResolvedValue({
      data: { id: 12, private: true, owner: { id: 888, login: "usekaneo" } },
    });

    const result = await verifyGithubInstallation({
      repositoryOwner: "usekaneo",
      repositoryName: "kaneo",
    });

    expect(result.isInstalled).toBe(true);
    expect(result.installationId).toBe(7777);
    expect(result.repositoryPrivate).toBe(true);
    expect(result.hasRequiredPermissions).toBe(false);
    expect(result.missingPermissions).toEqual(["issues"]);
    expect(result.message).toContain("issues");
    expect(result.settingsUrl).toBe(
      "https://github.com/settings/installations/7777",
    );
    expect(result.installationUrl).toContain("target_id=888");
  });

  it("returns a deterministic negative result when getRepoInstallation responds with 404", async () => {
    const error = Object.assign(new Error("Not Found"), { status: 404 });
    mockGetRepoInstallation.mockRejectedValue(error);

    const result = await verifyGithubInstallation({
      repositoryOwner: "usekaneo",
      repositoryName: "kaneo",
    });

    expect(result).toEqual({
      isInstalled: false,
      installationId: null,
      repositoryExists: null,
      repositoryPrivate: null,
      permissions: null,
      hasRequiredPermissions: false,
      missingPermissions: [],
      message:
        "GitHub App is not installed on this repository or the repository is not accessible",
      installationUrl:
        "https://github.com/apps/kaneo-app/installations/new/permissions",
      settingsUrl: "https://github.com/apps/kaneo-app",
    });

    expect(mockReposGet).not.toHaveBeenCalled();
    expect(mockGetInstallationOctokit).not.toHaveBeenCalled();
  });

  it("never calls repos.get on the base app octokit after a 404 from getRepoInstallation", async () => {
    const error = Object.assign(new Error("Not Found"), { status: 404 });
    mockGetRepoInstallation.mockRejectedValue(error);

    await verifyGithubInstallation({
      repositoryOwner: "usekaneo",
      repositoryName: "kaneo",
    });

    expect(mockReposGet).not.toHaveBeenCalled();
    expect(mockGetInstallationOctokit).not.toHaveBeenCalled();
  });

  it("throws HTTP 500 when the GitHub API fails with an unexpected status", async () => {
    const error = Object.assign(new Error("Server Error"), { status: 500 });
    mockGetRepoInstallation.mockRejectedValue(error);

    await expect(
      verifyGithubInstallation({
        repositoryOwner: "usekaneo",
        repositoryName: "kaneo",
      }),
    ).rejects.toMatchObject({
      status: 500,
    });
  });

  it("wraps getInstallationOctokit failures as HTTP 500", async () => {
    mockGetRepoInstallation.mockResolvedValue({
      data: { id: 4242, permissions: { issues: "write" } },
    });
    mockGetInstallationOctokit.mockRejectedValue(
      Object.assign(new Error("token exchange failed"), { status: 500 }),
    );

    await expect(
      verifyGithubInstallation({
        repositoryOwner: "usekaneo",
        repositoryName: "kaneo",
      }),
    ).rejects.toMatchObject({
      status: 500,
    });

    expect(mockReposGet).not.toHaveBeenCalled();
  });

  it("returns a deterministic negative result when repos.get responds with 404", async () => {
    mockGetRepoInstallation.mockResolvedValue({
      data: { id: 4242, permissions: { issues: "write" } },
    });
    mockGetInstallationOctokit.mockResolvedValue(makeInstallationOctokit());
    mockReposGet.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );

    const result = await verifyGithubInstallation({
      repositoryOwner: "usekaneo",
      repositoryName: "kaneo",
    });

    expect(result).toEqual({
      isInstalled: true,
      installationId: 4242,
      repositoryExists: false,
      repositoryPrivate: null,
      permissions: { issues: "write" },
      hasRequiredPermissions: false,
      missingPermissions: [],
      message:
        "GitHub App is installed but the repository is no longer accessible",
      settingsUrl: "https://github.com/settings/installations/4242",
      installationUrl: "https://github.com/apps/kaneo-app",
    });
  });

  it("wraps repos.get failures as HTTP 500 when the status is not 404", async () => {
    mockGetRepoInstallation.mockResolvedValue({
      data: { id: 4242, permissions: { issues: "write" } },
    });
    mockGetInstallationOctokit.mockResolvedValue(makeInstallationOctokit());
    mockReposGet.mockRejectedValue(
      Object.assign(new Error("Server Error"), { status: 500 }),
    );

    await expect(
      verifyGithubInstallation({
        repositoryOwner: "usekaneo",
        repositoryName: "kaneo",
      }),
    ).rejects.toMatchObject({
      status: 500,
    });
  });

  it("omits install URLs when GITHUB_APP_NAME is not configured and installation is missing", async () => {
    delete process.env.GITHUB_APP_NAME;
    const error = Object.assign(new Error("Not Found"), { status: 404 });
    mockGetRepoInstallation.mockRejectedValue(error);

    const result = await verifyGithubInstallation({
      repositoryOwner: "usekaneo",
      repositoryName: "kaneo",
    });

    expect(result.isInstalled).toBe(false);
    expect(result.installationUrl).toBeUndefined();
    expect(result.settingsUrl).toBeUndefined();
    expect(result.message).toContain("not installed");
  });

  it("normalizes a missing installation.permissions to null on the success path", async () => {
    mockGetRepoInstallation.mockResolvedValue({
      data: { id: 4242, permissions: undefined },
    });
    mockGetInstallationOctokit.mockResolvedValue(makeInstallationOctokit());
    mockReposGet.mockResolvedValue({
      data: { id: 99, private: false, owner: { id: 555, login: "usekaneo" } },
    });

    const result = await verifyGithubInstallation({
      repositoryOwner: "usekaneo",
      repositoryName: "kaneo",
    });

    expect(result.permissions).toBeNull();
    expect(result.hasRequiredPermissions).toBe(false);
  });

  it("matches the OpenAPI verification result schema for every returned shape", async () => {
    // The previous suite expressed the schema with valibot; zod is the
    // validator here.
    const verificationResultSchema = z.object({
      isInstalled: z.boolean(),
      installationId: z.number().nullable(),
      repositoryExists: z.boolean().nullable(),
      repositoryPrivate: z.boolean().nullable(),
      permissions: z.record(z.string(), z.string()).nullable(),
      hasRequiredPermissions: z.boolean(),
      missingPermissions: z.array(z.string()),
      message: z.string(),
      settingsUrl: z.string().optional(),
      installationUrl: z.string().optional(),
    });

    const scenarios: Array<{
      name: string;
      mock: () => ReturnType<typeof verifyGithubInstallation>;
    }> = [];

    mockGetRepoInstallation.mockResolvedValue({
      data: {
        id: 1,
        permissions: { issues: "write" },
      },
    });
    mockGetInstallationOctokit.mockResolvedValue(makeInstallationOctokit());
    mockReposGet.mockResolvedValue({
      data: { id: 2, private: false, owner: { id: 100, login: "usekaneo" } },
    });
    scenarios.push({
      name: "happy path",
      mock: () =>
        verifyGithubInstallation({
          repositoryOwner: "usekaneo",
          repositoryName: "kaneo",
        }),
    });

    mockGetRepoInstallation.mockResolvedValue({
      data: {
        id: 2,
        permissions: { metadata: "read" },
      },
    });
    mockGetInstallationOctokit.mockResolvedValue(makeInstallationOctokit());
    mockReposGet.mockResolvedValue({
      data: { id: 3, private: true, owner: { id: 200, login: "usekaneo" } },
    });
    scenarios.push({
      name: "missing permissions",
      mock: () =>
        verifyGithubInstallation({
          repositoryOwner: "usekaneo",
          repositoryName: "kaneo",
        }),
    });

    mockGetRepoInstallation.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    scenarios.push({
      name: "missing installation",
      mock: () =>
        verifyGithubInstallation({
          repositoryOwner: "usekaneo",
          repositoryName: "kaneo",
        }),
    });

    mockGetRepoInstallation.mockResolvedValue({
      data: { id: 4, permissions: { issues: "write" } },
    });
    mockGetInstallationOctokit.mockResolvedValue(makeInstallationOctokit());
    mockReposGet.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    scenarios.push({
      name: "installed but repo inaccessible",
      mock: () =>
        verifyGithubInstallation({
          repositoryOwner: "usekaneo",
          repositoryName: "kaneo",
        }),
    });

    for (const scenario of scenarios) {
      const response = await scenario.mock();
      expect(
        verificationResultSchema.safeParse(response),
        `scenario "${scenario.name}" should match the OpenAPI schema`,
      ).toMatchObject({ success: true });
    }
  });
});
