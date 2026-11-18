import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type CreateProjectRequest = InferRequestType<
  (typeof client)["project"]["$post"]
>["json"];

async function createProject({
  name,
  slug,
  workspaceId,
  icon,
  startDate,
  endDate,
}: CreateProjectRequest) {
  const response = await client.project.$post({
    json: { name, slug, icon, workspaceId, startDate, endDate },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const data = await response.json();

  return data;
}

export default createProject;
