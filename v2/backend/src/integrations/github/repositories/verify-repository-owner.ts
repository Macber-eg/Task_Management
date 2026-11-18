import { HTTPException } from "../../../common/errors/http-exception";
import type { GitHubDeps } from "../github-deps";
import { getGithubAccount } from "./github-account";

export type RepositoryBinding = {
  installationId: number;
  repositoryId: number;
  repositoryOwner: string;
  repositoryName: string;
  verifiedGithubAccountId: string;
  verifiedByUserId: string;
};

/** Account IDs come from completed OAuth, never from submitted repository data. */
export async function verifyRepositoryOwner(
  deps: GitHubDeps,
  userId: string,
  repositoryOwner: string,
  repositoryName: string,
): Promise<RepositoryBinding> {
  const account = await getGithubAccount(deps.db, userId);
  const accountId = Number(account.accountId);
  const app = deps.github.app();
  if (!app)
    throw new HTTPException(503, {
      message: "GitHub integration is unavailable",
    });
  try {
    const { data: installation } =
      await app.octokit.rest.apps.getRepoInstallation({
        owner: repositoryOwner,
        repo: repositoryName,
      });
    const octokit = await app.getInstallationOctokit(installation.id);
    const { data: user } = await octokit.rest.users.getById({
      account_id: accountId,
    });
    if (user.id !== accountId) throw new Error("GitHub identity mismatch");
    const { data: permission } =
      await octokit.rest.repos.getCollaboratorPermissionLevel({
        owner: repositoryOwner,
        repo: repositoryName,
        username: user.login,
      });
    if (permission.permission !== "admin") {
      throw new Error("GitHub repository admin permission is required");
    }
    const { data: repository } = await octokit.rest.repos.get({
      owner: repositoryOwner,
      repo: repositoryName,
    });
    return {
      installationId: installation.id,
      repositoryId: repository.id,
      repositoryOwner: repository.owner.login,
      repositoryName: repository.name,
      verifiedGithubAccountId: account.accountId,
      verifiedByUserId: userId,
    };
  } catch {
    // Do not expose installation or repository existence to unauthorized users.
    throw new HTTPException(403, {
      message:
        "Repository access could not be verified. GitHub repository admin permission and an installed Kaneo App are required",
    });
  }
}
