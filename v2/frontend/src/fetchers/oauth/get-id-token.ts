import { client } from "@/lib/api";
import type { InferResponseType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type GetIdTokenResponse = InferResponseType<
  (typeof client)["oauth"]["id-token"]["$get"],
  200
>;

export async function getIdToken() {
  const response = await client.oauth["id-token"].$get();

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  const data = await response.json();
  return data;
}
