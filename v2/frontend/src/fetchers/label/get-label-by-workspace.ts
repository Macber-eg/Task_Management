import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type GetLabelsByTaskRequest = InferRequestType<
  (typeof client)["label"]["workspace"][":workspaceId"]["$get"]
>["param"];

async function getLabelsByTask({ workspaceId }: GetLabelsByTaskRequest) {
  const response = await client.label.workspace[":workspaceId"].$get({
    param: {
      workspaceId,
    },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const data = await response.json();
  return data;
}

export default getLabelsByTask;
