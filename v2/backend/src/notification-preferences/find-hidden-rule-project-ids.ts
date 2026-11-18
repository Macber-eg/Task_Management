import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";

/**
 * Projects the user's rule for the workspace selects but the user can no
 * longer see. Saving the rule keeps them, so regaining access restores them.
 */
export async function findHiddenRuleProjectIds(
  manager: EntityManager,
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  const rows = (await manager.query(
    `SELECT selected.project_id AS "projectId"
     FROM user_notification_workspace_project AS selected
     INNER JOIN user_notification_workspace_rule AS rule
       ON rule.id = selected.workspace_rule_id
     WHERE rule.user_id = $1
       AND rule.workspace_id = $2
       AND NOT ${projectAccessCondition("$1", "selected.project_id")}`,
    [userId, workspaceId],
  )) as { projectId: string }[];
  return rows.map((row) => row.projectId);
}
