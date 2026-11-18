import { normalizeGiteaBaseUrl } from "../../links/normalize-gitea-base-url";
import { emptyGiteaResponse } from "./gitea-api-error";
import { giteaFetch } from "./gitea-fetch";

/** The token's user; throws a `GiteaApiError` for a bad token or instance. */
export async function verifyGiteaToken(baseUrl: string, token: string) {
  const user = await giteaFetch<{ id: number; login: string }>(
    normalizeGiteaBaseUrl(baseUrl),
    token,
    "/user",
  );
  if (!user) throw emptyGiteaResponse("user");
  return user;
}
