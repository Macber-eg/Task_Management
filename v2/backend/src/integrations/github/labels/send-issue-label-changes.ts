import type { IssueWrite } from "../../sync/issue-write";
import type { GitHubOctokit } from "../app/github-app";
import { addLabelsToIssue, removeLabel } from "./github-labels";

/**
 * The `send` step of `syncTaskFieldLabels` for one GitHub issue: removes the
 * stale labels, then adds the wanted ones (skipped when there are none,
 * unless `alwaysAdd`).
 */
export function sendIssueLabelChanges(
  octokit: GitHubOctokit,
  owner: string,
  repo: string,
  issueNumber: number,
  alwaysAdd = false,
) {
  return async (
    { add, remove }: { add: string[]; remove: string[] },
    write: IssueWrite,
  ): Promise<void> => {
    for (const name of remove)
      await removeLabel(octokit, owner, repo, issueNumber, name, write);
    if (alwaysAdd || add.length)
      await addLabelsToIssue(octokit, owner, repo, issueNumber, add, true, write);
  };
}
