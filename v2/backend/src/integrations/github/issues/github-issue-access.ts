import type { IssueAccess, IssueValues } from "../../core/issue-access";
import { formatIssueBody } from "../../links/issue-format";
import {
  linkedIssueNumber,
  normalizeProviderIssue,
} from "../../sync/normalize-provider-issue";
import type { GitHubApp } from "../app/github-app";
import type { GitHubConfig } from "../config/github-config";

/**
 * The linked issue through the bounded App client, for the resume review
 * (`ProviderIssues`) and issue label sync. The client is verified on first use.
 */
export async function githubIssueAccess(
  github: GitHubApp,
  integration: { config: string },
  link: { externalId: string; taskId: string },
): Promise<IssueAccess> {
  const number = linkedIssueNumber(link.externalId);
  const config = JSON.parse(integration.config) as GitHubConfig;
  const owner = config.repositoryOwner;
  const repo = config.repositoryName;
  let client: ReturnType<GitHubApp["verifiedInstallationOctokit"]> | undefined;
  const octokit = () =>
    (client ??= github.verifiedInstallationOctokit(config, true));
  return {
    read: async () =>
      normalizeProviderIssue(
        (
          await (await octokit()).rest.issues.get({
            owner,
            repo,
            issue_number: number,
            request: { timeout: 10_000 },
          })
        ).data,
        link.taskId,
      ),
    write: async (values: IssueValues) =>
      normalizeProviderIssue(
        (
          await (await octokit()).rest.issues.update({
            owner,
            repo,
            issue_number: number,
            title: values.title,
            body: formatIssueBody(values.description, link.taskId),
            state: values.state,
            request: { timeout: 10_000 },
          })
        ).data,
        link.taskId,
      ),
  };
}
