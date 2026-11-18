import type { EntityManager } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { IntegrationEntity } from "../../../database/entities/integration.entity";
import { normalizeGiteaBaseUrl } from "../../links/normalize-gitea-base-url";

/**
 * The token to verify or link with: the one given, else the project's saved
 * token, but only for the base URL it was saved for.
 */
export async function resolveVerificationToken(
  db: EntityManager,
  input: { projectId: string; baseUrl: string; accessToken?: string },
): Promise<string> {
  let baseUrl: string;
  try {
    baseUrl = normalizeGiteaBaseUrl(input.baseUrl);
  } catch {
    throw new HTTPException(400, {
      message:
        "Enter a valid HTTP or HTTPS Gitea URL without credentials, a query, or a fragment.",
    });
  }
  if (input.accessToken?.trim()) return input.accessToken.trim();
  const integration = await db.findOne(IntegrationEntity, {
    where: { projectId: input.projectId, type: "gitea" },
  });
  let config: { accessToken?: unknown; baseUrl?: unknown } | null = null;
  try {
    config = integration ? JSON.parse(integration.config) : null;
  } catch {
    throw new HTTPException(400, {
      message: "Invalid saved Gitea configuration. Reconnect the integration.",
    });
  }
  let savedBaseUrl: string | undefined;
  if (typeof config?.baseUrl === "string") {
    try {
      savedBaseUrl = normalizeGiteaBaseUrl(config.baseUrl);
    } catch {
      throw new HTTPException(400, {
        message:
          "Invalid saved Gitea configuration. Reconnect the integration.",
      });
    }
  }
  // Never forward a stored credential to an edited destination.
  if (
    typeof config?.accessToken !== "string" ||
    !config.accessToken.trim() ||
    typeof config.baseUrl !== "string" ||
    savedBaseUrl !== baseUrl
  ) {
    throw new HTTPException(400, {
      message: "Enter a personal access token to verify this Gitea instance.",
    });
  }
  return String(config.accessToken);
}
