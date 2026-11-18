import type { EntityManager } from "typeorm";
import { type IssueField, issueEditScope } from "./deferred-issue-edit";
import { updateExternalLink } from "./external-link-writes";
import { withIntegrationLink } from "./with-integration-link";

type Integration = {
  id: string;
  projectId: string;
  type: string;
  config: string;
};

/**
 * Queues an inbound provider edit on the link for the deferred-edit replay
 * job. Commit the intent before acknowledging a delivery which cannot wait for
 * its writer.
 */
export async function deferIssueEdit(
  db: EntityManager,
  link: { id: string; taskId: string },
  integration: Integration,
  fields: IssueField[],
): Promise<void> {
  await withIntegrationLink(
    db,
    link,
    integration,
    async (tx) => {
      await updateExternalLink(tx, link.id, {
        deferredEdit: { fields, scope: issueEditScope(integration) },
      });
    },
    {
      validate: (binding) =>
        issueEditScope(binding) === issueEditScope(integration),
    },
  );
}

/**
 * Queues outbound repairs of `fields` for the replay job. Coalesces remaining
 * local corrections by link and field without storing task text.
 */
export async function deferTaskSync(
  db: EntityManager,
  link: { id: string; taskId: string },
  integration: Integration,
  fields: IssueField[],
): Promise<void> {
  await withIntegrationLink(
    db,
    link,
    integration,
    async (tx) => {
      await updateExternalLink(tx, link.id, {
        deferredEdit: {
          fields: [],
          repairFields: fields,
          scope: issueEditScope(integration),
        },
      });
    },
    integration,
  );
}
