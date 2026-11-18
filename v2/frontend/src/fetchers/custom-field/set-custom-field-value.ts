import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type SetCustomFieldValueRequest = InferRequestType<
  (typeof client)["custom-field"]["value"]["$put"]
>["json"];

async function setCustomFieldValue({
  taskId,
  fieldId,
  value,
}: SetCustomFieldValueRequest) {
  const response = await client["custom-field"].value.$put({
    json: { taskId, fieldId, value },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default setCustomFieldValue;
