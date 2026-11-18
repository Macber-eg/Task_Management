import { Check } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTaskPhase } from "@/hooks/mutations/task/use-update-task-phase";
import type { ProjectPhase } from "@/fetchers/planning/planning-api";
import { useGetPhases } from "@/hooks/queries/planning/use-get-phases";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskPhasePopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskPhasePopover({
  task,
  children,
}: TaskPhasePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: phases = [] } = useGetPhases(task.projectId);
  const { mutateAsync: updatePhase } = useUpdateTaskPhase();

  const handleSelect = useCallback(
    async (phaseId: string | null) => {
      try {
        await updatePhase({
          taskId: task.id,
          phaseId,
          projectId: task.projectId,
        });
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.phase.updateError"),
        );
      }
    },
    [task.id, task.projectId, t, updatePhase],
  );

  const current = phases.find((p: ProjectPhase) => p.id === task.phaseId);

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
          {!task.phaseId ? (
            <Check className="mr-2 size-3.5" />
          ) : (
            <span className="mr-2 size-3.5" />
          )}
          {t("tasks:popover.phase.none")}
        </Button>
        {phases.map((phase: ProjectPhase) => (
          <Button
            key={phase.id}
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            onClick={() => handleSelect(phase.id)}
          >
            {task.phaseId === phase.id ? (
              <Check className="mr-2 size-3.5 shrink-0" />
            ) : (
              <span className="mr-2 size-3.5 shrink-0" />
            )}
            <span className="truncate">{phase.name}</span>
          </Button>
        ))}
        {phases.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("tasks:popover.phase.empty")}
          </p>
        )}
        {current && (
          <p className="border-t border-border px-2 pt-2 text-[10px] text-muted-foreground">
            {current.name}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
