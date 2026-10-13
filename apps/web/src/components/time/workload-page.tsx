import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { fetchWorkloadReport } from "@/fetchers/time-analytics/time-analytics-api";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { cn } from "@/lib/cn";
import { formatSecondsAsHours } from "@/lib/time-metrics";

type WorkloadPageProps = {
  workspaceId: string;
  initialProjectId?: string;
};

function weekRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function WorkloadPage({
  workspaceId,
  initialProjectId,
}: WorkloadPageProps) {
  const { t } = useTranslation();
  const initial = weekRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");

  const { data: projects = [] } = useGetProjects({ workspaceId }, true);

  const query = useMemo(
    () => ({
      workspaceId,
      from: `${from}T00:00:00.000Z`,
      to: `${to}T23:59:59.999Z`,
      ...(projectId ? { projectId } : {}),
    }),
    [workspaceId, from, to, projectId],
  );

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["workload", query],
    queryFn: () => fetchWorkloadReport(query),
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t("tasks:time.export.from")}
          </Label>
          <Input
            type="date"
            className="h-8"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t("tasks:time.export.to")}
          </Label>
          <Input
            type="date"
            className="h-8"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t("tasks:time.export.project")}
          </Label>
          <Select
            value={projectId || "__all"}
            onValueChange={(value) =>
              setProjectId(value === "__all" || value == null ? "" : value)
            }
          >
            <SelectTrigger className="h-8 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">
                {t("tasks:time.export.allProjects")}
              </SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          {t("common:empty.loading")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("tasks:time.workload.member")}</TableHead>
              <TableHead className="text-right">
                {t("tasks:time.workload.capacity")}
              </TableHead>
              <TableHead className="text-right">
                {t("tasks:time.workload.planned")}
              </TableHead>
              <TableHead className="text-right">
                {t("tasks:time.workload.actual")}
              </TableHead>
              <TableHead>{t("tasks:time.workload.load")}</TableHead>
              <TableHead className="text-right">
                {t("tasks:time.workload.available")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const load = row.workloadPercent ?? 0;
              const overloaded = row.overloadedMinutes > 0;
              return (
                <TableRow
                  key={row.userId}
                  className={cn(overloaded && "bg-amber-500/5")}
                >
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {overloaded ? (
                        <AlertTriangle className="size-3.5 text-amber-600" />
                      ) : null}
                      {row.userName}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSecondsAsHours(row.rangeCapacityMinutes * 60)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSecondsAsHours(row.plannedMinutes * 60)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatSecondsAsHours(row.actualSeconds)}
                  </TableCell>
                  <TableCell className="min-w-[8rem]">
                    <div className="space-y-1">
                      <Progress value={Math.min(load, 100)} className="h-2" />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {row.workloadPercent != null
                          ? `${row.workloadPercent.toFixed(0)}%`
                          : "N/A"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {overloaded
                      ? `+${formatSecondsAsHours(row.overloadedMinutes * 60)}`
                      : formatSecondsAsHours(row.availableMinutes * 60)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
