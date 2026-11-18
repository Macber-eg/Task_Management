import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type GetActivitesByTaskIdRequest = InferRequestType<
  (typeof client)["activity"][":taskId"]["$get"]
>["param"] & { limit?: number };

async function getActivitesByTaskId({
  taskId,
  limit,
}: GetActivitesByTaskIdRequest) {
  const response = await client.activity[":taskId"].$get({
    param: { taskId },
    query: limit === undefined ? {} : { limit: String(limit) },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default getActivitesByTaskId;
