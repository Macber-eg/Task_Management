import { useMutation } from "@tanstack/react-query";
import createProject from "@/fetchers/project/create-project";

function useCreateProject({
  name,
  slug,
  workspaceId,
  icon,
  startDate,
  endDate,
}: {
  name: string;
  slug: string;
  workspaceId: string;
  icon: string;
  startDate?: string | null;
  endDate?: string | null;
}) {
  return useMutation({
    mutationFn: () =>
      createProject({ name, slug, workspaceId, icon, startDate, endDate }),
  });
}

export default useCreateProject;
