import type { IssueAccess, IssueValues } from "../core/issue-access";
import { formatIssueBody } from "../links/issue-format";
import {
  linkedIssueNumber,
  normalizeProviderIssue,
} from "../sync/normalize-provider-issue";
import { createGitlabClient } from "./client/gitlab-client";
import type { GitlabConfig } from "./config";

/** A linked GitLab issue for the sync engine. Confidential issues are refused. */
export function gitlabIssueAccess(
  rawConfig: string,
  link: { externalId: string; taskId: string },
): IssueAccess {
  const number = linkedIssueNumber(link.externalId);
  const config = JSON.parse(rawConfig) as GitlabConfig;
  const client = createGitlabClient(config);
  return {
    read: async () => {
      const issue = await client.getIssue(config.projectPath, number);
      if (issue.confidential)
        throw new Error("Confidential issue cannot be synchronized");
      return normalizeProviderIssue(issue, link.taskId);
    },
    write: async (values: IssueValues) =>
      normalizeProviderIssue(
        await client.updateIssue(config.projectPath, number, {
          title: values.title,
          description: formatIssueBody(values.description, link.taskId),
          state_event: values.state === "closed" ? "close" : "reopen",
        }),
        link.taskId,
      ),
  };
}
