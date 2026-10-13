import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export type SubtaskSummary = {
  id: string;
  title: string;
  number: number | null;
  status: string;
};

type SubtaskResponse = {
  byParent: Record<string, SubtaskSummary[]>;
};

async function fetchProjectSubtasks(projectId: string) {
  const response = await fetch(getApiUrl(`task/subtasks/${projectId}`), {
    credentials: "include",
  });
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json() as Promise<SubtaskResponse>;
}

export function useGetProjectSubtasks(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["subtasks", projectId],
    queryFn: () => fetchProjectSubtasks(projectId),
    enabled: Boolean(projectId) && enabled,
  });
}
