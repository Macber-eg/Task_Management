import type { EntityManager } from "typeorm";
import { In } from "typeorm";
import { IntegrationEntity } from "../../database/entities/integration.entity";
import { readSyncRules, syncProviders } from "./rules";

export type SyncIntegration = IntegrationEntity & {
  parsedConfig: Record<string, unknown>;
};

/**
 * The project's active git-provider integrations that have saved sync rules.
 * Legacy integrations (no `syncRules`) keep their task-created behaviour and
 * are not reconciled.
 */
export async function getSyncIntegrations(
  db: EntityManager,
  projectId: string,
  integrationId?: string,
): Promise<SyncIntegration[]> {
  const rows = await db.find(IntegrationEntity, {
    where: {
      projectId,
      isActive: true,
      type: In([...syncProviders]),
      ...(integrationId ? { id: integrationId } : {}),
    },
  });
  return rows.flatMap((integration) => {
    try {
      const config = JSON.parse(integration.config) as Record<string, unknown>;
      return config.syncRules && readSyncRules(config)
        ? [Object.assign(integration, { parsedConfig: config })]
        : [];
    } catch {
      return [];
    }
  });
}
