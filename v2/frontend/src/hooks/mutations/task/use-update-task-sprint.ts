import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskSprint from "@/fetchers/task/update-task-sprint";

export function useUpdateTaskSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      sprintId,
    }: {
      taskId: string;
      sprintId: string | null;
      projectId: string;
    }) => updateTaskSprint(taskId, sprintId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task", variables.taskId] });
      queryClient.invalidateQueries({
        queryKey: ["tasks", variables.projectId],
      });
    },
  });
}
