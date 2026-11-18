import { HTTPException } from "../../../common/errors/http-exception";
import { normalizeGiteaBaseUrl } from "../../links/normalize-gitea-base-url";
import { GiteaApiError } from "../client/gitea-api-error";
import { createGiteaClient } from "../client/gitea-client";
import { verifyGiteaToken } from "../client/verify-gitea-token";

type FailureReason =
  | "not_a_gitea_instance"
  | "redirected"
  | "repository_not_found";

function failed(message: string, failureReason: FailureReason) {
  return {
    isInstalled: false,
    hasRequiredPermissions: false,
    repositoryExists: false,
    repositoryPrivate: null,
    missingPermissions: [] as string[],
    message,
    failureReason,
  };
}

const NOT_GITEA = "The URL does not point to a Gitea instance.";

/**
 * Whether the URL is a Gitea instance and the token can manage the
 * repository's issues. Expected failures are answered in the body.
 */
export async function verifyGiteaAccess({
  baseUrl,
  accessToken,
  repositoryOwner,
  repositoryName,
}: {
  baseUrl: string;
  accessToken: string;
  repositoryOwner: string;
  repositoryName: string;
}) {
  try {
    const normalized = normalizeGiteaBaseUrl(baseUrl);
    try {
      await verifyGiteaToken(normalized, accessToken);
    } catch (error) {
      // A 404 from /user means the URL does not point at a Gitea instance
      // (or the token endpoint is misrouted), not a repository lookup failure.
      if (error instanceof GiteaApiError && error.status === 404) {
        return failed(NOT_GITEA, "not_a_gitea_instance");
      }
      throw error;
    }

    const client = createGiteaClient({ baseUrl: normalized, accessToken });
    const repo = await client.getRepo(repositoryOwner, repositoryName);

    const perms = repo.permissions;
    const hasIssuesWrite = perms?.admin === true || perms?.push === true;

    return {
      isInstalled: true,
      hasRequiredPermissions: Boolean(hasIssuesWrite),
      repositoryExists: true,
      repositoryPrivate: repo.private,
      missingPermissions: hasIssuesWrite ? [] : ["issues (write)"],
      message: hasIssuesWrite
        ? "Token can access the repository."
        : "Token may not have sufficient permissions to manage issues.",
      failureReason: null,
    };
  } catch (error) {
    const err = error as { status?: number; message?: string };

    if (error instanceof GiteaApiError) {
      if (error.kind === "REDIRECT") {
        return failed(
          `The Gitea URL redirected (HTTP ${error.status}). This usually means the server forces HTTPS. Please use the final URL directly.`,
          "redirected",
        );
      }

      if (error.kind === "INVALID_JSON") {
        return failed(NOT_GITEA, "not_a_gitea_instance");
      }
    }

    if (err.status === 404) {
      return failed(
        "Repository not found or not accessible with this token.",
        "repository_not_found",
      );
    }

    if (err.status === 401) {
      throw new HTTPException(400, {
        message: "Invalid Gitea token or unauthorized.",
      });
    }

    throw new HTTPException(500, {
      message:
        error instanceof Error
          ? error.message
          : "Failed to verify Gitea access",
    });
  }
}
