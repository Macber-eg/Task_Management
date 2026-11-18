import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type DeleteCommentRequest = InferRequestType<
  (typeof client)["activity"]["comment"]["$delete"]
>["json"];

async function deleteComment({ activityId }: DeleteCommentRequest) {
  const response = await client.activity.comment.$delete({
    json: { activityId },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const data = await response.json();

  return data;
}

export default deleteComment;
