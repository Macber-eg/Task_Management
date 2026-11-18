import type { IssueAccess, IssueValues } from "../core/issue-access";
import { formatIssueBody } from "../links/issue-format";
import {
  linkedIssueNumber,
  normalizeProviderIssue,
} from "../sync/normalize-provider-issue";
import { createGiteaClient } from "./client/gitea-client";
import type { GiteaConfig } from "./config";

/**
 * A linked Gitea issue for the sync engine. Writes carry the content version
 * of the last read, so Gitea refuses them over a concurrent edit.
 */
export function giteaIssueAccess(
  rawConfig: string,
  link: { externalId: string; taskId: string },
): IssueAccess {
  const number = linkedIssueNumber(link.externalId);
  const config = JSON.parse(rawConfig) as GiteaConfig;
  const { repositoryOwner: owner, repositoryName: repo } = config;
  const client = createGiteaClient(config);
  let contentVersion: number | undefined;
  return {
    read: async () => {
      const issue = await client.getIssue(owner, repo, number);
      contentVersion = issue.content_version;
      return normalizeProviderIssue(issue, link.taskId);
    },
    write: async (values: IssueValues) =>
      normalizeProviderIssue(
        await client.updateIssue(owner, repo, number, {
          title: values.title,
          body: formatIssueBody(values.description, link.taskId),
          state: values.state,
          ...(contentVersion === undefined
            ? {}
            : { content_version: contentVersion }),
        }),
        link.taskId,
      ),
  };
}
