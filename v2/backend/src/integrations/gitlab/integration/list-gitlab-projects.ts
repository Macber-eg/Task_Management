import { ApiError } from "../../../common/errors/api-error";
import { createGitlabClient } from "../client/gitlab-client";
import { verifyGitlabToken } from "../client/verify-gitlab-token";
import type { GitlabTokenType } from "../config";
import { parseGitlabBaseUrl } from "./gitlab-input";

type ProjectRow = {
  id: number;
  name: string;
  path_with_namespace: string;
  name_with_namespace: string;
  visibility: string;
  web_url: string;
};

const PER_PAGE = 50;
const MAX_PAGES = 50;

/** The GitLab projects a token is a member of (at most 2,500). */
export async function listGitlabProjects({
  baseUrl,
  accessToken,
  tokenType,
}: {
  baseUrl: string;
  accessToken: string;
  tokenType: GitlabTokenType;
}): Promise<{ projects: ProjectRow[] }> {
  const normalized = parseGitlabBaseUrl(baseUrl);

  try {
    await verifyGitlabToken(normalized, accessToken, tokenType);
  } catch {
    throw new ApiError(401, {
      message: "Invalid GitLab token or could not reach instance.",
      code: "INTEGRATION_AUTH_FAILED",
    });
  }

  const client = createGitlabClient({
    baseUrl: normalized,
    accessToken,
    tokenType,
  });

  const projects: ProjectRow[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await client.listMemberProjects(page, PER_PAGE);
    if (batch.length === 0) break;

    for (const project of batch) {
      projects.push({
        id: project.id,
        name: project.name,
        path_with_namespace: project.path_with_namespace,
        name_with_namespace: project.name_with_namespace,
        visibility: project.visibility,
        web_url: project.web_url,
      });
    }

    if (batch.length < PER_PAGE) break;
  }

  return { projects };
}
