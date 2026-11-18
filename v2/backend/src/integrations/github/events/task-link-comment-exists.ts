import type { GitHubOctokit } from "../app/github-app";

/** Whether the issue already carries the task-link comment `body`. */
export async function taskLinkCommentExists(
  octokit: GitHubOctokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<boolean> {
  // A failed create response can leave a delivered comment without its local
  // completion marker. Read outside the write guard; any retry gets a fresh one.
  for (let page = 1; ; page++) {
    const { data } = await octokit.rest.issues
      .listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
        page,
        request: { timeout: 10_000 },
      })
      .catch(() => {
        throw new Error("Task-link comment could not be verified");
      });
    if (data.some((comment) => comment.body === body)) return true;
    if (data.length < 100) return false;
  }
}
