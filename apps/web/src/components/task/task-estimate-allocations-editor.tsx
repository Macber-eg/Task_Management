import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchTaskEstimateAllocations,
  saveTaskEstimateAllocations,
} from "@/fetchers/task/task-estimate-allocations";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import {
  formatMinutesAsHours,
  minutesFromHoursAndMinutes,
} from "@/lib/time-metrics";
import { toast } from "@/lib/toast";

type Row = {
  rowKey: string;
  userId: string;
  hours: string;
  minutes: string;
};

type TaskEstimateAllocationsEditorProps = {
  taskId: string;
  workspaceId: string;
  canEdit: boolean;
};

export default function TaskEstimateAllocationsEditor({
  taskId,
  workspaceId,
  canEdit,
}: TaskEstimateAllocationsEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: task } = useGetTask(taskId);
  const { data: membersRaw } = useGetActiveWorkspaceUsers(workspaceId);
  const members = useMemo(
    () => (Array.isArray(membersRaw) ? membersRaw : []),
    [membersRaw],
  );
  const { data: allocations = [] } = useQuery({
    queryKey: ["task-estimate-allocations", taskId],
    queryFn: () => fetchTaskEstimateAllocations(taskId),
    enabled: !!taskId,
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(
      allocations.map((row) => ({
        rowKey: row.id,
        userId: row.userId,
        hours: String(Math.floor(row.estimatedMinutes / 60)),
        minutes: String(row.estimatedMinutes % 60),
      })),
    );
  }, [allocations]);

  const totalAllocated = useMemo(
    () =>
      rows.reduce(
        (sum, row) =>
          sum +
          minutesFromHoursAndMinutes(
            Number(row.hours) || 0,
            Number(row.minutes) || 0,
          ),
        0,
      ),
    [rows],
  );

  const taskEstimate = task?.estimatedMinutes ?? 0;
  const unallocated = Math.max(0, taskEstimate - totalAllocated);
  const overAllocated = taskEstimate > 0 && totalAllocated > taskEstimate;

  const save = async () => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const payload = rows
        .filter((row) => row.userId)
        .map((row) => ({
          userId: row.userId,
          estimatedMinutes: minutesFromHoursAndMinutes(
            Number(row.hours) || 0,
            Number(row.minutes) || 0,
          ),
        }))
        .filter((row) => row.estimatedMinutes > 0);
      await saveTaskEstimateAllocations(taskId, payload);
      await queryClient.invalidateQueries({
        queryKey: ["task-estimate-allocations", taskId],
      });
      toast.success(t("tasks:time.allocationsSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:time.allocationsSaveError"),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit && rows.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-border px-2 pt-3">
      <Label className="text-xs text-muted-foreground">
        {t("tasks:time.memberAllocations")}
      </Label>
      {rows.map((row, index) => (
        <div key={row.rowKey} className="flex flex-wrap items-end gap-2">
          <Select
            value={row.userId || undefined}
            disabled={!canEdit}
            onValueChange={(userId) =>
              setRows((prev) =>
                prev.map((item, i) =>
                  i === index ? { ...item, userId: userId ?? "" } : item,
                ),
              )
            }
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder={t("tasks:time.selectMember")} />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.user?.name ?? member.userId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            className="h-8 w-14 tabular-nums"
            value={row.hours}
            disabled={!canEdit}
            onChange={(event) =>
              setRows((prev) =>
                prev.map((item, i) =>
                  i === index ? { ...item, hours: event.target.value } : item,
                ),
              )
            }
          />
          <Input
            type="number"
            min={0}
            max={59}
            className="h-8 w-14 tabular-nums"
            value={row.minutes}
            disabled={!canEdit}
            onChange={(event) =>
              setRows((prev) =>
                prev.map((item, i) =>
                  i === index ? { ...item, minutes: event.target.value } : item,
                ),
              )
            }
          />
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="size-8 p-0"
              onClick={() =>
                setRows((prev) => prev.filter((_, i) => i !== index))
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setRows((prev) => [
                ...prev,
                {
                  rowKey: `draft-${crypto.randomUUID()}`,
                  userId: "",
                  hours: "0",
                  minutes: "0",
                },
              ])
            }
          >
            <Plus className="size-3.5" />
            {t("tasks:time.addAllocation")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || overAllocated}
            onClick={() => void save()}
          >
            {t("tasks:time.saveAllocations")}
          </Button>
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {t("tasks:time.allocatedTotal")}: {formatMinutesAsHours(totalAllocated)}
        {taskEstimate > 0 ? (
          <>
            {" · "}
            {t("tasks:time.unallocated")}: {formatMinutesAsHours(unallocated)}
          </>
        ) : null}
        {overAllocated ? (
          <span className="text-amber-600">
            {" "}
            · {t("tasks:time.overAllocated")}
          </span>
        ) : null}
      </p>
    </div>
  );
}
