import type { EntityManager } from "typeorm";
import type { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import type { PluginContext } from "../../core/task-events";
import { findExternalLinksByTask } from "../../links/external-link-queries";

/** The task's issue link for this integration, if any. */
export async function findIssueLink(
  db: EntityManager,
  taskId: string,
  context: PluginContext,
): Promise<ExternalLinkEntity | undefined> {
  const links = await findExternalLinksByTask(db, taskId);
  return links.find(
    (link) =>
      link.integrationId === context.integrationId &&
      link.resourceType === "issue",
  );
}
