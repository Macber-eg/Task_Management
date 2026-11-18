import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type GetProjectRequest = InferRequestType<
  (typeof client)["project"][":id"]["$get"]
>["param"] & {
  workspaceId: string;
};

async function getProject({ id }: GetProjectRequest) {
  const response = await client.project[":id"].$get({
    param: { id },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const data = await response.json();

  return data;
}

export default getProject;
