import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type UpdateLabelRequest = InferRequestType<
  (typeof client)["label"][":id"]["$put"]
>["json"] &
  InferRequestType<(typeof client)["label"][":id"]["$put"]>["param"];

async function updateLabel({ id, name, color }: UpdateLabelRequest) {
  const response = await client.label[":id"].$put({
    param: { id },
    json: { name, color },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const data = await response.json();
  return data;
}

export default updateLabel;
