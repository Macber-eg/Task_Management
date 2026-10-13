import { AlertTriangle, Clock3, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import deleteTimeEntry from "@/fetchers/time-entry/delete-time-entry";
import useCreateTimeEntry from "@/hooks/mutations/time-entry/use-create-time-entry";
import useGetTask from "@/hooks/queries/task/use-get-task";
import useGetTimeEntriesByTaskId from "@/hooks/queries/time-entry/use-get-time-entries";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  formatClockDuration,
  formatMinutesSeconds,
} from "@/lib/format-duration";
import { formatSecondsAsHours, summarizeEffort } from "@/lib/time-metrics";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import TaskEstimateEditor from "./task-estimate-editor";
import TaskEstimateAllocationsEditor from "./task-estimate-allocations-editor";
import { useTaskTimer } from "./task-timer-context";

type TaskTimeTrackingProps = {
  taskId: string;
  workspaceId: string;
};

const MAX_MANUAL_SECONDS = 24 * 60 * 60;

export default function TaskTimeTracking({
  taskId,
  workspaceId,
}: TaskTimeTrackingProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const timer = useTaskTimer();
  const createEntry = useCreateTimeEntry();
  const { data: task } = useGetTask(taskId);
  const { data: entries = [] } = useGetTimeEntriesByTaskId(taskId);
  const { canUpdateTasks } = useWorkspacePermission();
  const canManage = canUpdateTasks();
  const isRunning = timer.isRunningTask(taskId);
  const [manualHours, setManualHours] = useState("");
  const [manualMinutes, setManualMinutes] = useState("");
  const [workDate, setWorkDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [manualNote, setManualNote] = useState("");

  const loggedSeconds = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0),
    [entries],
  );

  const totalSeconds = loggedSeconds + (isRunning ? timer.elapsed : 0);
  const effort = summarizeEffort(task?.estimatedMinutes, totalSeconds);

  const byUser = useMemo(() => {
    const map = new Map<string, { name: string; seconds: number }>();
    for (const entry of entries) {
      const key = entry.userId ?? "unknown";
      const name = entry.userName ?? t("tasks:time.unknownUser");
      const prev = map.get(key) ?? { name, seconds: 0 };
      prev.seconds += entry.duration ?? 0;
      map.set(key, prev);
    }
    return [...map.values()].sort((a, b) => b.seconds - a.seconds);
  }, [entries, t]);

  const addManualTime = async () => {
    const hours = Math.max(0, Number.parseInt(manualHours || "0", 10) || 0);
    const minutes = Math.max(
      0,
      Math.min(59, Number.parseInt(manualMinutes || "0", 10) || 0),
    );
    const durationSeconds = hours * 3600 + minutes * 60;

    if (durationSeconds < 60) {
      toast.error(t("tasks:properties.manualInvalid"));
      return;
    }
    if (durationSeconds > MAX_MANUAL_SECONDS) {
      toast.error(t("tasks:properties.manualTooLong"));
      return;
    }

    const endTime = new Date(`${workDate}T23:59:00.000Z`);
    const startTime = new Date(endTime.getTime() - durationSeconds * 1000);

    try {
      await createEntry.mutateAsync({
        taskId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        description: manualNote.trim() || undefined,
      });
      setManualHours("");
      setManualMinutes("");
      setManualNote("");
      toast.success(t("tasks:properties.manualAdded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:properties.manualInvalid"),
      );
    }
  };

  const removeEntry = async (entryId: string) => {
    if (!window.confirm(t("tasks:time.deleteEntryConfirm"))) return;
    try {
      await deleteTimeEntry(entryId);
      await queryClient.invalidateQueries({
        queryKey: ["time-entries", taskId],
      });
      toast.success(t("tasks:time.entryDeleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:time.entryDeleteError"),
      );
    }
  };

  const progressValue = effort.utilizationPercent
    ? Math.min(effort.utilizationPercent, 100)
    : 0;

  return (
    <div className="flex flex-col gap-4 px-2 pb-2">
      <TaskEstimateEditor taskId={taskId} canEdit={canManage} />
      <TaskEstimateAllocationsEditor
        taskId={taskId}
        workspaceId={workspaceId}
        canEdit={canManage}
      />

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric
          label={t("tasks:time.actualHours")}
          value={formatSecondsAsHours(totalSeconds)}
        />
        <Metric
          label={t("tasks:time.remainingEstimate")}
          value={formatSecondsAsHours(effort.remainingMinutes * 60)}
        />
        <Metric
          label={t("tasks:time.variance")}
          value={
            effort.estimatedMinutes > 0
              ? `${effort.varianceMinutes >= 0 ? "+" : ""}${formatSecondsAsHours(Math.abs(effort.varianceMinutes) * 60)}`
              : "N/A"
          }
          warn={effort.overEstimate}
        />
        <Metric
          label={t("tasks:time.utilization")}
          value={
            effort.utilizationPercent != null
              ? `${effort.utilizationPercent.toFixed(0)}%`
              : "N/A"
          }
          warn={effort.overEstimate}
        />
      </div>

      {effort.estimatedMinutes > 0 ? (
        <div className="space-y-1">
          <Progress value={progressValue} className="h-2" />
          {effort.overEstimate ? (
            <p className="flex items-center gap-1 text-xs font-medium text-amber-600">
              <AlertTriangle className="size-3.5" />
              {t("tasks:time.overEstimate")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-sm">
        <Clock3 className="size-4 text-muted-foreground" />
        <div>
          <p className="font-semibold tabular-nums">
            {formatMinutesSeconds(totalSeconds)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatClockDuration(totalSeconds)}{" "}
            {t("tasks:properties.timeLogged")}
          </p>
        </div>
      </div>

      {isRunning && (
        <p className="text-xs font-medium text-violet-600 tabular-nums">
          {t("tasks:properties.timeRunning")}:{" "}
          {formatMinutesSeconds(timer.elapsed)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={timer.isPending || isRunning || createEntry.isPending}
          onClick={() => void timer.startTimer(taskId)}
        >
          {t("tasks:properties.startTimer")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={timer.isPending || !isRunning || createEntry.isPending}
          onClick={() => void timer.stopTimer()}
        >
          {t("tasks:properties.stopTimer")}
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-xs font-medium">{t("tasks:time.logTime")}</span>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("tasks:time.workDate")}
            <Input
              type="date"
              className="h-8 w-36"
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("tasks:time.hours")}
            <Input
              type="number"
              min={0}
              className="h-8 w-16 tabular-nums"
              value={manualHours}
              onChange={(event) => setManualHours(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("tasks:time.minutes")}
            <Input
              type="number"
              min={0}
              max={59}
              className="h-8 w-16 tabular-nums"
              value={manualMinutes}
              onChange={(event) => setManualMinutes(event.target.value)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={createEntry.isPending || timer.isPending}
            onClick={() => void addManualTime()}
          >
            {t("tasks:time.addEntry")}
          </Button>
        </div>
        <Input
          type="text"
          className="h-8 text-sm"
          value={manualNote}
          onChange={(event) => setManualNote(event.target.value)}
          placeholder={t("tasks:properties.manualNote")}
          maxLength={500}
        />
      </div>

      {byUser.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium">
            {t("tasks:time.teamContributions")}
          </p>
          <ul className="space-y-1 text-xs">
            {byUser.map((row) => (
              <li
                key={row.name}
                className="flex justify-between gap-2 tabular-nums"
              >
                <span className="truncate">{row.name}</span>
                <span>{formatSecondsAsHours(row.seconds)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium">{t("tasks:time.entryHistory")}</p>
          <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
            {[...entries].reverse().map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-2 rounded-md border border-border/60 p-2"
              >
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">
                    {formatSecondsAsHours(entry.duration ?? 0)}
                    {entry.userName ? ` · ${entry.userName}` : null}
                  </p>
                  <p className="text-muted-foreground">
                    {new Date(entry.startTime).toLocaleDateString()}
                    {entry.description ? ` — ${entry.description}` : null}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="size-7 shrink-0 p-0"
                    onClick={() => void removeEntry(entry.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/60 px-2 py-1.5",
        warn && "border-amber-500/50 bg-amber-500/5",
      )}
    >
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}
