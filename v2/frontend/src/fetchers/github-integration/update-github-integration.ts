import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type UpdateGithubIntegrationRequest = InferRequestType<
  (typeof client)["github-integration"]["project"][":projectId"]["$patch"]
>["json"];

async function updateGithubIntegration(
  projectId: string,
  json: UpdateGithubIntegrationRequest,
) {
  const response = await client["github-integration"].project[
    ":projectId"
  ].$patch({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default updateGithubIntegration;
