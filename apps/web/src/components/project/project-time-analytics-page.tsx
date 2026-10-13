import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchProjectTimeReport } from "@/fetchers/time-analytics/time-analytics-api";
import { formatSecondsAsHours } from "@/lib/time-metrics";

type ProjectTimeAnalyticsPageProps = {
  projectId: string;
  workspaceId: string;
  sprintId?: string;
  phaseId?: string;
};

export default function ProjectTimeAnalyticsPage({
  projectId,
  workspaceId,
  sprintId,
  phaseId,
}: ProjectTimeAnalyticsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["time-analytics", projectId, phaseId, sprintId],
    queryFn: () => fetchProjectTimeReport(projectId, { phaseId, sprintId }),
  });

  if (isLoading || !data) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {t("common:empty.loading")}
      </p>
    );
  }

  const utilization = data.utilizationPercent ?? 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({
              to: "/dashboard/workspace/$workspaceId/timesheets",
              params: { workspaceId },
              search: { projectId },
            })
          }
        >
          {t("navigation:sidebar.timesheets")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({
              to: "/dashboard/workspace/$workspaceId/workload",
              params: { workspaceId },
              search: { projectId },
            })
          }
        >
          {t("navigation:sidebar.workload")}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          title={t("tasks:time.totalEstimate")}
          value={formatSecondsAsHours(data.estimatedMinutes * 60)}
        />
        <Kpi
          title={t("tasks:time.totalActual")}
          value={formatSecondsAsHours(data.actualSeconds)}
        />
        <Kpi
          title={t("tasks:time.tasksOverEstimate")}
          value={String(data.tasksOverEstimate)}
        />
        <Kpi
          title={t("tasks:time.completedTasks")}
          value={`${data.completedTasks}/${data.taskCount}`}
        />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {t("tasks:time.overallUtilization")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={Math.min(utilization, 100)} className="h-2" />
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {data.utilizationPercent != null
              ? `${data.utilizationPercent.toFixed(1)}%`
              : "N/A"}
          </p>
        </CardContent>
      </Card>

      <Section title={t("tasks:time.phasePerformance")}>
        <ReportTable
          rows={data.phases.map((row) => ({
            id: row.phaseId,
            name: row.name,
            estimate: row.estimatedMinutes,
            actual: row.actualSeconds,
            utilization: row.utilizationPercent,
          }))}
        />
      </Section>

      <Section title={t("tasks:time.sprintPerformance")}>
        <ReportTable
          rows={data.sprints.map((row) => ({
            id: row.sprintId,
            name: row.name,
            estimate: row.estimatedMinutes,
            actual: row.actualSeconds,
            utilization: row.utilizationPercent,
          }))}
        />
      </Section>

      <Section title={t("tasks:time.taskPerformance")}>
        <ReportTable
          rows={data.tasks.map((row) => ({
            id: row.taskId,
            name: row.title,
            estimate: row.estimatedMinutes,
            actual: row.actualSeconds,
            utilization: row.utilizationPercent,
            warn: row.overEstimate,
          }))}
        />
      </Section>
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-normal text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ReportTable({
  rows,
}: {
  rows: Array<{
    id: string;
    name: string;
    estimate: number;
    actual: number;
    utilization: number | null;
    warn?: boolean;
  }>;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("tasks:time.noRows")}</p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("tasks:time.name")}</TableHead>
          <TableHead className="text-right">
            {t("tasks:time.estimatedHours")}
          </TableHead>
          <TableHead className="text-right">
            {t("tasks:time.actualHours")}
          </TableHead>
          <TableHead className="text-right">
            {t("tasks:time.utilization")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className={row.warn ? "bg-amber-500/5" : undefined}
          >
            <TableCell className="max-w-[16rem] truncate">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatSecondsAsHours(row.estimate * 60)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatSecondsAsHours(row.actual)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.utilization != null
                ? `${row.utilization.toFixed(0)}%`
                : "N/A"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
