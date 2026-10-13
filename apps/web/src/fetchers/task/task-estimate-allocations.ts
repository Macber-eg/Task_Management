import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export type TaskEstimateAllocation = {
  id: string;
  taskId: string;
  userId: string;
  userName: string | null;
  estimatedMinutes: number;
};

export async function fetchTaskEstimateAllocations(taskId: string) {
  const response = await fetch(
    getApiUrl(`task/estimate-allocations/${taskId}`),
    {
      credentials: "include",
    },
  );
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json() as Promise<TaskEstimateAllocation[]>;
}

export async function saveTaskEstimateAllocations(
  taskId: string,
  allocations: Array<{ userId: string; estimatedMinutes: number }>,
) {
  const response = await fetch(
    getApiUrl(`task/estimate-allocations/${taskId}`),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allocations }),
    },
  );
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json() as Promise<TaskEstimateAllocation[]>;
}
