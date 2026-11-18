import type { IssueWrite } from "../../sync/issue-write";
import type { GiteaConfig } from "../config";
import { addLabelsToIssueGitea, removeLabelGitea } from "../labels/gitea-issue-labels";

/** Applies a `syncTaskFieldLabels` change set to a Gitea issue. */
export async function sendIssueLabelChanges(
  config: GiteaConfig,
  issueNumber: number,
  { add, remove }: { add: string[]; remove: string[] },
  write: IssueWrite,
): Promise<void> {
  for (const name of remove)
    await removeLabelGitea(config, issueNumber, name, write, true);
  if (add.length)
    await addLabelsToIssueGitea(config, issueNumber, add, true, write);
}
