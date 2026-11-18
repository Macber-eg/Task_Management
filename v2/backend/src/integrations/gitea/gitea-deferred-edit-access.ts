import type { DeferredEditAccess } from "../git-shared/deferred-issue-edit-providers";
import type { IssueField } from "../links/deferred-issue-edit";
import { formatIssueBody } from "../links/issue-format";
import { linkedIssueNumber } from "../sync/normalize-provider-issue";
import { createGiteaClient } from "./client/gitea-client";
import type { GiteaConfig } from "./config";

/** The linked Gitea issue for the deferred-edit replay job. */
export async function giteaDeferredEditAccess(
  integration: { config: string },
  link: { externalId: string; taskId: string },
): Promise<DeferredEditAccess> {
  const number = linkedIssueNumber(link.externalId);
  const config = JSON.parse(integration.config) as GiteaConfig;
  const { repositoryOwner: owner, repositoryName: repo } = config;
  const client = createGiteaClient(config);
  const payload = (field: IssueField, value: string) =>
    field === "description"
      ? { body: formatIssueBody(value, link.taskId) }
      : { [field]: value };
  return {
    read: () => client.getIssue(owner, repo, number),
    write: async (field, value) =>
      (await client.updateIssue(owner, repo, number, payload(field, value)))
        ?.updated_at,
  };
}
