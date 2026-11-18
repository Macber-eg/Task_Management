import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchProjectTimeReport } from "@/fetchers/time-analytics/time-analytics-api";
import { formatSecondsAsHours } from "@/lib/time-metrics";
import { cn } from "@/lib/cn";

type SprintTimeSummaryProps = {
  projectId: string;
  sprintId: string;
  className?: string;
};

export default function SprintTimeSummary({
  projectId,
  sprintId,
  className,
}: SprintTimeSummaryProps) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["time-analytics", projectId, undefined, sprintId],
    queryFn: () => fetchProjectTimeReport(projectId, { sprintId }),
  });

  if (!data) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-card/80 px-3 py-2 text-xs",
        className,
      )}
    >
      <span className="font-medium">{t("tasks:time.sprintTime")}</span>
      <span className="tabular-nums text-muted-foreground">
        {t("tasks:time.estimatedHours")}:{" "}
        <strong className="text-foreground">
          {formatSecondsAsHours(data.estimatedMinutes * 60)}
        </strong>
      </span>
      <span className="tabular-nums text-muted-foreground">
        {t("tasks:time.actualHours")}:{" "}
        <strong className="text-foreground">
          {formatSecondsAsHours(data.actualSeconds)}
        </strong>
      </span>
      <span className="tabular-nums text-muted-foreground">
        {t("tasks:time.utilization")}:{" "}
        <strong
          className={cn(
            data.overEstimate ? "text-amber-600" : "text-foreground",
          )}
        >
          {data.utilizationPercent != null
            ? `${data.utilizationPercent.toFixed(0)}%`
            : "N/A"}
        </strong>
      </span>
    </div>
  );
}
