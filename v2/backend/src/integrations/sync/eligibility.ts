import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import { IntegrationEntity } from "../../database/entities/integration.entity";
import { updateExternalLink } from "../links/external-link-writes";
import { isSyncPaused, type LabelRule, readSyncRules } from "./rules";
import { sameConfig } from "./same-config";
import { runSql, sql } from "./sql-fragment";
import { outgoingPredicate } from "./task-predicate";

export async function taskMatchesRule(
  db: EntityManager,
  taskId: string,
  projectId: string,
  rule: LabelRule,
): Promise<boolean> {
  const [task] = (await db.query(
    `SELECT id FROM task WHERE id = $1 AND project_id = $2`,
    [taskId, projectId],
  )) as unknown[];
  if (!task) return false;
  if (rule.mode === "all") return true;
  const [project] = (await db.query(
    `SELECT workspace_id AS "workspaceId" FROM project WHERE id = $1`,
    [projectId],
  )) as { workspaceId: string }[];
  if (!project) return false;
  const { predicate } = await outgoingPredicate(db, project.workspaceId, rule);
  const [matching] = await runSql(
    db,
    sql`select task.id from task where task.id = ${taskId} and task.project_id = ${projectId} and ${predicate}`,
  );
  return !!matching;
}

/**
 * Whether the integration may sync this task now: active, unchanged config
 * (when `expectedConfig` is given), matching its outgoing rule and not
 * paused. A task that no longer matches has its issue links paused.
 */
export async function canSyncTask(
  db: EntityManager,
  taskId: string,
  integrationId: string,
  expectedConfig?: string,
): Promise<boolean> {
  const integration = await db.findOne(IntegrationEntity, {
    where: { id: integrationId },
  });
  if (
    !integration?.isActive ||
    (expectedConfig !== undefined &&
      !sameConfig(integration.config, expectedConfig))
  )
    return false;
  const rules = readSyncRules(integration.config);
  const matches =
    !!rules &&
    (await taskMatchesRule(db, taskId, integration.projectId, rules.outgoing));
  const links = await db.find(ExternalLinkEntity, {
    where: { integrationId, taskId, resourceType: "issue" },
  });
  if (!matches) {
    for (const link of links) {
      if (!isSyncPaused(link.metadata))
        await updateExternalLink(db, link.id, {
          metadata: { syncFilterPaused: true },
        });
    }
    return false;
  }
  return !links.some((link) => isSyncPaused(link.metadata));
}
