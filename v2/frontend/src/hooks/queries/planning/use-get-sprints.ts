import { useQuery } from "@tanstack/react-query";
import getSprints from "@/fetchers/planning/get-sprints";

export function useGetSprints(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["sprints", projectId],
    queryFn: () => getSprints(projectId),
    enabled: Boolean(projectId) && enabled,
  });
}
