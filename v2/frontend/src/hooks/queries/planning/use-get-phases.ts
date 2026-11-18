import { useQuery } from "@tanstack/react-query";
import getPhases from "@/fetchers/planning/get-phases";

export function useGetPhases(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["phases", projectId],
    queryFn: () => getPhases(projectId),
    enabled: Boolean(projectId) && enabled,
  });
}
