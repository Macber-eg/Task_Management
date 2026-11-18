import { client } from "@/lib/api";
import type { InferResponseType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type GetBillingResponse = InferResponseType<
  (typeof client)["billing"][":workspaceId"]["$get"],
  200
>;

export async function getBilling(workspaceId: string) {
  const response = await client.billing[":workspaceId"].$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}
