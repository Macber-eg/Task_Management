import { startGitlabFakeServer } from "./gitlab-fake-server";

/**
 * A stand-in Gitea REST API: the same recording JSON server as the GitLab
 * fixture (routes by `METHOD path`, unrouted requests answer 404).
 */
export const startGiteaFakeServer = startGitlabFakeServer;

export type GiteaFakeServer = Awaited<ReturnType<typeof startGiteaFakeServer>>;

/** `/api/v1/repos/{owner}/{repo}{suffix}` */
export function giteaRepoApi(owner: string, repo: string, suffix = ""): string {
  return `/api/v1/repos/${owner}/${repo}${suffix}`;
}
