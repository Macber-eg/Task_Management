import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

async function updateTaskEstimate(
  taskId: string,
  estimatedMinutes: number | null,
) {
  const response = await fetch(getApiUrl(`task/estimate/${taskId}`), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ estimatedMinutes }),
  });
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json();
}

export default updateTaskEstimate;
