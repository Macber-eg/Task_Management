import { HTTPException } from "../../../common/errors/http-exception";
import { normalizeGiteaBaseUrl } from "../../links/normalize-gitea-base-url";
import { createGiteaClient } from "../client/gitea-client";
import { verifyGiteaToken } from "../client/verify-gitea-token";

type RepoRow = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string };
  html_url: string;
};

/** Every repository the token can reach (50 pages of 50 at most). */
export async function listGiteaRepositories({
  baseUrl,
  accessToken,
}: {
  baseUrl: string;
  accessToken: string;
}): Promise<{ repositories: RepoRow[] }> {
  const normalized = normalizeGiteaBaseUrl(baseUrl);

  try {
    await verifyGiteaToken(normalized, accessToken);
  } catch {
    throw new HTTPException(400, {
      message: "Invalid Gitea token or could not reach instance.",
    });
  }

  const client = createGiteaClient({ baseUrl: normalized, accessToken });

  const all: RepoRow[] = [];
  let page = 1;

  while (true) {
    const batch = await client.listUserRepos(page, 50);
    if (!batch.length) break;

    for (const repo of batch) {
      all.push({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        private: repo.private,
        owner: { login: repo.owner?.login ?? repo.owner?.username ?? "" },
        html_url: repo.html_url,
      });
    }

    if (batch.length < 50) break;
    page += 1;
    if (page > 50) break;
  }

  return { repositories: all };
}
