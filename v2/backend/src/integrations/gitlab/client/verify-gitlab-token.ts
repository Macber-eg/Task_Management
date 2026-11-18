import type { GitlabTokenType } from "../config";
import { normalizeGitlabBaseUrl } from "../gitlab-url";
import { requiredGitlabResponse } from "./gitlab-api-error";
import { gitlabFetch } from "./gitlab-fetch";

/** The token's user; throws a `GitlabApiError` for a bad token or instance. */
export async function verifyGitlabToken(
  baseUrl: string,
  token: string,
  tokenType: GitlabTokenType,
) {
  return requiredGitlabResponse(
    await gitlabFetch<{ id: number; username: string }>(
      normalizeGitlabBaseUrl(baseUrl),
      token,
      tokenType,
      "/user",
    ),
    "user",
  );
}
