import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import type { GitlabConfig } from "../config";
import { normalizeGitlabBaseUrl, normalizeProjectPath } from "../gitlab-url";

const logger = new Logger("GitlabWebhook");

export type GitlabIntegration = IntegrationEntity & {
  project: NonNullable<IntegrationEntity["project"]>;
};

/** Active GitLab integrations (with their project) bound to this GitLab project. */
export async function findAllIntegrationsByGitlabProject(
  db: EntityManager,
  baseUrl: string,
  projectPath: string,
  integrationId?: string,
): Promise<GitlabIntegration[]> {
  const normalizedBase = normalizeGitlabBaseUrl(baseUrl);
  const normalizedPath = normalizeProjectPath(projectPath);

  const integrations = await db.find(IntegrationEntity, {
    where: {
      type: "gitlab",
      isActive: true,
      ...(integrationId ? { id: integrationId } : {}),
    },
    relations: { project: true },
  });

  return integrations.filter((integration): integration is GitlabIntegration => {
    if (!integration.project) return false;
    try {
      const config = JSON.parse(integration.config) as GitlabConfig;
      const matches =
        normalizeGitlabBaseUrl(config.baseUrl) === normalizedBase &&
        normalizeProjectPath(config.projectPath) === normalizedPath;
      if (integrationId && !matches) {
        logger.warn(
          `Signed integration project mismatch (integration ${integrationId})`,
        );
      }
      return matches;
    } catch {
      return false;
    }
  });
}
