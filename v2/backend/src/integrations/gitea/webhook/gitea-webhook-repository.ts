import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { normalizeGiteaBaseUrl } from "../../links/normalize-gitea-base-url";
import type { GiteaConfig } from "../config";

const logger = new Logger("GiteaWebhook");

/** The repository block every Gitea webhook payload carries. */
export type GiteaWebhookRepository = {
  owner: { login?: string; username?: string };
  name: string;
  html_url: string;
};

/** The instance base URL, from a repository's `html_url` (`{base}/{owner}/{repo}`). */
export function baseUrlFromRepositoryHtmlUrl(htmlUrl: string): string {
  try {
    const u = new URL(htmlUrl);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return "";
    }

    const basePathSegments = segments.slice(0, -2);
    const basePath =
      basePathSegments.length > 0 ? `/${basePathSegments.join("/")}` : "";

    return normalizeGiteaBaseUrl(`${u.origin}${basePath}`);
  } catch {
    return "";
  }
}

export function repoOwnerLogin(repo: {
  owner?: { login?: string; username?: string };
}): string {
  return repo.owner?.login ?? repo.owner?.username ?? "";
}

/**
 * The active Gitea integrations (with their project) bound to the payload's
 * repository; only `integrationId` when the delivery was signed for it.
 */
export async function findGiteaIntegrations(
  db: EntityManager,
  repository: GiteaWebhookRepository,
  integrationId?: string,
): Promise<IntegrationEntity[]> {
  const baseUrl = baseUrlFromRepositoryHtmlUrl(repository.html_url);
  if (!baseUrl) return [];
  return findAllIntegrationsByGiteaRepo(
    db,
    baseUrl,
    repoOwnerLogin(repository),
    repository.name,
    integrationId,
  );
}

export async function findAllIntegrationsByGiteaRepo(
  db: EntityManager,
  baseUrl: string,
  owner: string,
  repo: string,
  integrationId?: string,
): Promise<IntegrationEntity[]> {
  const normalized = normalizeGiteaBaseUrl(baseUrl);
  const integrations = await db.find(IntegrationEntity, {
    where: {
      type: "gitea",
      isActive: true,
      ...(integrationId ? { id: integrationId } : {}),
    },
    relations: { project: true },
  });

  return integrations.filter((integration) => {
    try {
      const config = JSON.parse(integration.config) as GiteaConfig;
      const matches =
        normalizeGiteaBaseUrl(config.baseUrl) === normalized &&
        config.repositoryOwner === owner &&
        config.repositoryName === repo;
      if (integrationId && !matches) {
        logger.warn(
          `Signed integration repository mismatch (integration ${integrationId})`,
        );
      }
      return matches;
    } catch {
      return false;
    }
  });
}
