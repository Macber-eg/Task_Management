import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import { readSyncRules } from "../sync/rules";
import { getAuthorizedSyncProject } from "./get-authorized-sync-project";
import { getSyncIntegration } from "./get-sync-integration";

/**
 * Locks everything a resume phase validates: project, binding, task, the
 * rule's selected labels and the task's label copies, and the link itself.
 */
export async function lockResumeScope(
  tx: EntityManager,
  projectId: string,
  provider: string,
  linkId: string,
  authorizedWorkspaceId: string,
): Promise<void> {
  await getAuthorizedSyncProject(tx, projectId, authorizedWorkspaceId, true);
  const integration = await getSyncIntegration(tx, projectId, provider);
  const [binding] = (await tx.query(
    `SELECT config FROM integration WHERE id = $1 FOR SHARE`,
    [integration.id],
  )) as { config: string }[];
  const link = await tx.findOne(ExternalLinkEntity, {
    where: {
      id: linkId,
      integrationId: integration.id,
      resourceType: "issue",
    },
  });
  if (!link) throw new HTTPException(404, { message: "Linked task not found" });
  await tx.query(
    `SELECT id FROM task WHERE id = $1 AND project_id = $2 FOR NO KEY UPDATE`,
    [link.taskId, projectId],
  );
  const rule = readSyncRules(binding!.config)?.outgoing;
  if (!rule)
    throw new HTTPException(409, {
      message: "Integration rules changed; review again",
    });
  if (rule.mode === "labels") {
    // Protect both selected roots and assigned copies against rename/deletion
    // while validating each local resume phase.
    await tx.query(
      `SELECT id FROM label
       WHERE workspace_id = $1
         AND ((task_id IS NULL AND id = ANY($2::text[])) OR task_id = $3)
       ORDER BY id FOR SHARE`,
      [integration.project.workspaceId, rule.labels, link.taskId],
    );
  }
  await tx.query(`SELECT id FROM external_link WHERE id = $1 FOR UPDATE`, [
    linkId,
  ]);
}
