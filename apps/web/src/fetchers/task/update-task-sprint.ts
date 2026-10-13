import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

async function updateTaskSprint(taskId: string, sprintId: string | null) {
  const response = await fetch(getApiUrl(`task/sprint/${taskId}`), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sprintId }),
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default updateTaskSprint;
