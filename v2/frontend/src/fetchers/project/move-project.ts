import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type MoveProjectRequest = InferRequestType<
  (typeof client)["project"][":id"]["move"]["$put"]
>["json"] &
  InferRequestType<(typeof client)["project"][":id"]["move"]["$put"]>["param"];

async function moveProject({ id, workspaceId }: MoveProjectRequest) {
  const response = await client.project[":id"].move.$put({
    param: { id },
    json: { workspaceId },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const data = await response.json();

  return data;
}

export default moveProject;
