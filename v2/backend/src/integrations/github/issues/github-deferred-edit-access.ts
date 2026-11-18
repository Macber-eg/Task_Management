import type { DeferredEditAccess } from "../../git-shared/deferred-issue-edit-providers";
import type { IssueField } from "../../links/deferred-issue-edit";
import { formatIssueBody } from "../../links/issue-format";
import { linkedIssueNumber } from "../../sync/normalize-provider-issue";
import type { GitHubApp } from "../app/github-app";
import type { GitHubConfig } from "../config/github-config";

/** The linked issue for the deferred-edit replay, through the bounded App client. */
export async function githubDeferredEditAccess(
  github: GitHubApp,
  integration: { config: string },
  link: { externalId: string; taskId: string },
): Promise<DeferredEditAccess> {
  const number = linkedIssueNumber(link.externalId);
  const config = JSON.parse(integration.config) as GitHubConfig;
  const { repositoryOwner: owner, repositoryName: repo } = config;
  const payload = (field: IssueField, value: string) =>
    field === "description"
      ? { body: formatIssueBody(value, link.taskId) }
      : { [field]: value };
  const octokit = await github.verifiedInstallationOctokit(config, true);
  return {
    read: async () =>
      (
        await octokit.rest.issues.get({
          owner,
          repo,
          issue_number: number,
          request: { timeout: 10_000 },
        })
      ).data,
    write: async (field, value) =>
      (
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: number,
          ...payload(field, value),
          request: { timeout: 10_000 },
        })
      )?.data?.updated_at,
  };
}
