// Ported from tests/api/github-integration/outbound-binding.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubApp } from "./github-app";

const m = vi.hoisted(() => ({ repo: vi.fn(), client: vi.fn() }));
vi.mock("octokit", () => ({
  App: class {
    getInstallationOctokit = m.client;
  },
  Octokit: { defaults: () => class {} },
}));

const binding = {
  repositoryOwner: "owner",
  repositoryName: "repo",
  installationId: 10,
  repositoryId: 20,
  verifiedGithubAccountId: "30",
  verifiedByUserId: "user",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_PRIVATE_KEY_BASE64", "");
  vi.stubEnv("GITHUB_PRIVATE_KEY", "unit-test-key");
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "unit-test-secret");
  m.client.mockResolvedValue({ rest: { repos: { get: m.repo } } });
});
afterEach(() => vi.unstubAllEnvs());

describe("GitHub outgoing repository binding", () => {
  const verified = (config: Parameters<GitHubApp["verifiedInstallationOctokit"]>[0]) =>
    new GitHubApp().verifiedInstallationOctokit(config);

  it("permits only the verified numeric repository", async () => {
    m.repo.mockResolvedValue({ data: { id: 20 } });
    await expect(verified(binding)).resolves.toHaveProperty("rest");
    expect(m.client).toHaveBeenCalledWith(10);
  });

  it("rejects a name reused for a different repository", async () => {
    m.repo.mockResolvedValue({ data: { id: 21 } });
    await expect(verified(binding)).rejects.toThrow("identity changed");
  });

  it("rejects a legacy binding without contacting GitHub", async () => {
    await expect(
      verified({
        repositoryOwner: "owner",
        repositoryName: "repo",
        installationId: 10,
      }),
    ).rejects.toThrow("requires verification");
    expect(m.client).not.toHaveBeenCalled();
  });

  it("fails closed when the verified installation loses repository access", async () => {
    m.repo.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    await expect(verified(binding)).rejects.toMatchObject({ status: 404 });
  });
});
