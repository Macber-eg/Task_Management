import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskPhase from "@/fetchers/task/update-task-phase";

export function useUpdateTaskPhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      phaseId,
    }: {
      taskId: string;
      phaseId: string | null;
      projectId: string;
    }) => updateTaskPhase(taskId, phaseId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task", variables.taskId] });
      queryClient.invalidateQueries({
        queryKey: ["tasks", variables.projectId],
      });
    },
  });
}
