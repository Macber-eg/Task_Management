import type { EntityManager } from "typeorm";
import type { EventBus } from "../../events/event-bus";
import { readSyncRules, syncProviders } from "./rules";

/**
 * A workspace label was renamed or is being deleted: every git integration
 * whose outgoing rule selects it is re-reconciled
 * (`integration.sync_labels_changed`), and, unless disabled, every project
 * with a git integration in the workspace is announced as updated.
 */
export async function notifySyncWorkspaceLabelChanged(
  db: EntityManager,
  events: EventBus,
  workspaceId: string,
  labelId: string,
  { publishProjectUpdates = true }: { publishProjectUpdates?: boolean } = {},
): Promise<void> {
  const integrations = (await db.query(
    `SELECT integration.id, integration.project_id AS "projectId", integration.config
     FROM integration
     INNER JOIN project ON project.id = integration.project_id
     WHERE project.workspace_id = $1 AND integration.type = ANY($2::text[])`,
    [workspaceId, [...syncProviders]],
  )) as { id: string; projectId: string; config: string }[];
  const projects = new Set<string>();
  for (const integration of integrations) {
    projects.add(integration.projectId);
    const rule = readSyncRules(integration.config)?.outgoing;
    if (rule?.mode === "labels" && rule.labels.includes(labelId))
      await events.publish("integration.sync_labels_changed", {
        projectId: integration.projectId,
        integrationId: integration.id,
      });
  }
  if (publishProjectUpdates)
    for (const projectId of projects)
      await events.publish("project.updated", { projectId });
}
