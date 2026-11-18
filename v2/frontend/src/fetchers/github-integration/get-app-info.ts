import { client } from "@/lib/api";
import type { InferResponseType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type GitHubAppInfo = InferResponseType<
  (typeof client)["github-integration"]["app-info"]["$get"],
  200
>;

export default async function getGitHubAppInfo(): Promise<GitHubAppInfo> {
  const response = await client["github-integration"]["app-info"].$get();

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const result = await response.json();
  return result;
}
