import { apiFetch } from "@/lib/api";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

async function updateTaskPhase(taskId: string, phaseId: string | null) {
  const response = await apiFetch(getApiUrl(`task/phase/${taskId}`), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phaseId }),
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default updateTaskPhase;
