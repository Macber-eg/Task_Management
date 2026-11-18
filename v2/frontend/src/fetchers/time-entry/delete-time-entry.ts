import { apiFetch } from "@/lib/api";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

async function deleteTimeEntry(id: string) {
  const response = await apiFetch(getApiUrl(`time-entry/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json();
}

export default deleteTimeEntry;
