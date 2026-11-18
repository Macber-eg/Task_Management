import type { EntityManager } from "typeorm";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import type { ProjectEntity } from "../../../database/entities/project.entity";
import {
  type GitHubConfig,
  hasVerifiedGitHubBinding,
} from "../config/github-config";

export type GitHubWebhookSource = {
  installation?: { id: number };
  repository: { id: number };
};

export type RepositoryIntegration = IntegrationEntity & {
  project: ProjectEntity;
};

/**
 * The active, verified GitHub integrations bound to the delivery's
 * installation and repository id (never its mutable owner/name).
 */
export async function findRepositoryIntegrations(
  db: EntityManager,
  source: GitHubWebhookSource,
): Promise<RepositoryIntegration[]> {
  const installationId = source.installation?.id;
  const repositoryId = source.repository.id;
  if (
    !Number.isSafeInteger(installationId) ||
    !Number.isSafeInteger(repositoryId)
  )
    return [];
  const integrations = await db.find(IntegrationEntity, {
    where: { type: "github", isActive: true },
    relations: { project: true },
  });
  return integrations.filter((integration): integration is RepositoryIntegration => {
    try {
      const config = JSON.parse(integration.config) as GitHubConfig;
      return (
        !!integration.project &&
        hasVerifiedGitHubBinding(config) &&
        config.installationId === installationId &&
        config.repositoryId === repositoryId
      );
    } catch {
      return false;
    }
  });
}
