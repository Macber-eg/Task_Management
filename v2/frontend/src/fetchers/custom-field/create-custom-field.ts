import { client } from "@/lib/api";
import type { InferRequestType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type CreateCustomFieldRequest = InferRequestType<
  (typeof client)["custom-field"]["$post"]
>["json"];

async function createCustomField({
  projectId,
  name,
  type,
  required,
  defaultValue,
  options,
}: CreateCustomFieldRequest) {
  const response = await client["custom-field"].$post({
    json: {
      projectId,
      name,
      type,
      required,
      defaultValue,
      options,
    },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default createCustomField;
