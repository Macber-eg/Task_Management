import { Check } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTaskSprint } from "@/hooks/mutations/task/use-update-task-sprint";
import type { ProjectSprint } from "@/fetchers/planning/planning-api";
import { useGetSprints } from "@/hooks/queries/planning/use-get-sprints";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskSprintPopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskSprintPopover({
  task,
  children,
}: TaskSprintPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: sprints = [] } = useGetSprints(task.projectId);
  const visibleSprints = useMemo(() => {
    if (!task.phaseId) return sprints;
    return sprints.filter(
      (sprint: ProjectSprint) =>
        !sprint.phaseId || sprint.phaseId === task.phaseId,
    );
  }, [sprints, task.phaseId]);
  const { mutateAsync: updateSprint } = useUpdateTaskSprint();

  const handleSelect = useCallback(
    async (sprintId: string | null) => {
      try {
        await updateSprint({
          taskId: task.id,
          sprintId,
          projectId: task.projectId,
        });
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.sprint.updateError"),
        );
      }
    },
    [task.id, task.projectId, t, updateSprint],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start font-normal"
          onClick={() => handleSelect(null)}
        >
          {!task.sprintId ? (
            <Check className="mr-2 size-3.5" />
          ) : (
            <span className="mr-2 size-3.5" />
          )}
          {t("tasks:popover.sprint.none")}
        </Button>
        {visibleSprints.map((sprint: ProjectSprint) => (
          <Button
            key={sprint.id}
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            onClick={() => handleSelect(sprint.id)}
          >
            {task.sprintId === sprint.id ? (
              <Check className="mr-2 size-3.5 shrink-0" />
            ) : (
              <span className="mr-2 size-3.5 shrink-0" />
            )}
            <span className="truncate">{sprint.name}</span>
          </Button>
        ))}
        {visibleSprints.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("tasks:popover.sprint.empty")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
