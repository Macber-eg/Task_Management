import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import updateTaskEstimate from "@/fetchers/task/update-task-estimate";
import useGetTask from "@/hooks/queries/task/use-get-task";
import {
  formatMinutesAsHours,
  minutesFromHoursAndMinutes,
} from "@/lib/time-metrics";
import { toast } from "@/lib/toast";

type TaskEstimateEditorProps = {
  taskId: string;
  canEdit: boolean;
};

export default function TaskEstimateEditor({
  taskId,
  canEdit,
}: TaskEstimateEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: task } = useGetTask(taskId);
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const total = task?.estimatedMinutes ?? 0;
    setHours(String(Math.floor(total / 60)));
    setMinutes(String(total % 60));
  }, [task?.estimatedMinutes]);

  const save = async () => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const estimatedMinutes = minutesFromHoursAndMinutes(
        Number(hours),
        Number(minutes),
      );
      await updateTaskEstimate(
        taskId,
        estimatedMinutes > 0 ? estimatedMinutes : null,
      );
      await queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(t("tasks:time.estimateSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:time.estimateSaveError"),
      );
    } finally {
      setBusy(false);
    }
  };

  const label = formatMinutesAsHours(task?.estimatedMinutes ?? 0);

  return (
    <div className="flex flex-col gap-2 px-2">
      <Label className="text-xs text-muted-foreground">
        {t("tasks:time.estimatedHours")}
      </Label>
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">
              {t("tasks:time.hours")}
            </span>
            <Input
              type="number"
              min={0}
              className="h-8 w-16 tabular-nums"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">
              {t("tasks:time.minutes")}
            </span>
            <Input
              type="number"
              min={0}
              max={59}
              className="h-8 w-16 tabular-nums"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void save()}
          >
            {t("tasks:time.saveEstimate")}
          </Button>
        </div>
      ) : (
        <p className="text-sm font-medium tabular-nums">{label || "—"}</p>
      )}
    </div>
  );
}
