import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type DeleteProjectRequest = InferRequestType<
  (typeof client)["project"][":id"]["$delete"]
>["param"];

async function deleteProject({ id }: DeleteProjectRequest) {
  const response = await client.project[":id"].$delete({ param: { id } });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const data = await response.json();

  return data;
}

export default deleteProject;
