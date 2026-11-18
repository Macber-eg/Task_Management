import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { IntegrationEntity } from "../../database/entities/integration.entity";
import { withIntegrationLink } from "../links/with-integration-link";
import { canSyncTask } from "./eligibility";
import type { IssueWrite } from "./issue-write";
import { readSyncRules } from "./rules";
import { sameConfig } from "./same-config";

const logger = new Logger("IssueWriteDispatch");

/**
 * Starts a provider write while the link's sync scope (rule labels, pause
 * state, binding) is locked, then settles it after the commit. Answers
 * undefined when the task may no longer be synced; nothing was sent then.
 */
export async function dispatchIssueWrite<T>(
  db: EntityManager,
  link: { id: string; taskId: string; integrationId: string | null },
  expectedConfig: string | undefined,
  send: () => Promise<T>,
): Promise<{ value: T } | undefined> {
  if (!link.integrationId) return;
  const integration = await db.findOne(IntegrationEntity, {
    where: { id: link.integrationId },
    relations: { project: true },
  });
  if (!integration?.project) return;
  const workspaceId = integration.project.workspaceId;
  let request: Promise<{ value: T } | { error: unknown }> | undefined;
  try {
    await withIntegrationLink(
      db,
      link,
      integration,
      async (tx) => {
        const rule = readSyncRules(integration.config)?.outgoing;
        if (rule?.mode === "labels") {
          await tx.query(
            `SELECT id FROM label
             WHERE workspace_id = $1
               AND ((task_id IS NULL AND id = ANY($2::text[])) OR task_id = $3)
             ORDER BY id FOR SHARE`,
            [workspaceId, rule.labels, link.taskId],
          );
        }
        if (!(await canSyncTask(tx, link.taskId, integration.id, expectedConfig)))
          return;
        // Start the request while pause/rule/label writes are excluded. Settle it
        // after commit so provider latency never holds these row locks.
        request = send().then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      },
      {
        type: integration.type,
        validate: (binding) =>
          sameConfig(binding.config, integration.config) &&
          (expectedConfig === undefined ||
            sameConfig(binding.config, expectedConfig)),
      },
    );
  } catch (error) {
    if (!request) throw error;
    // The eligible dispatch path only reads/locks rows. A failed commit cannot
    // undo its provider request; settle it so the caller records its outcome.
    logger.error(
      `Issue write scope transaction failed after dispatch (integration ${integration.id}, link ${link.id})`,
    );
  }
  if (!request) return;
  const result = await (request as Promise<{ value: T } | { error: unknown }>);
  if ("error" in result) throw result.error;
  return result;
}

/** An `IssueWrite` bound to one link; throws when the scope changed. */
export function createIssueWrite(
  db: EntityManager,
  link: Parameters<typeof dispatchIssueWrite>[1],
  expectedConfig: string | undefined,
): IssueWrite {
  return async (send) => {
    const result = await dispatchIssueWrite(db, link, expectedConfig, send);
    if (!result) throw new Error("Issue sync scope changed");
    return result.value;
  };
}
