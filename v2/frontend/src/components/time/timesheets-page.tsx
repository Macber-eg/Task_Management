import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchTimesheets,
  type TimesheetRow,
} from "@/fetchers/time-analytics/time-analytics-api";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { downloadCsv } from "@/lib/export-csv";
import { formatSecondsAsHours } from "@/lib/time-metrics";

type TimesheetsPageProps = {
  workspaceId: string;
  initialProjectId?: string;
};

type GroupBy = "none" | "employee" | "project" | "task";

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function TimesheetsPage({
  workspaceId,
  initialProjectId,
}: TimesheetsPageProps) {
  const { t } = useTranslation();
  const range = defaultRange();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [userId, setUserId] = useState("");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  const { data: projects = [] } = useGetProjects({ workspaceId }, true);
  const { data: users = [] } = useGetActiveWorkspaceUsers(workspaceId);

  const query = useMemo(() => {
    const params: Record<string, string> = {
      workspaceId,
      from: `${from}T00:00:00.000Z`,
      to: `${to}T23:59:59.999Z`,
    };
    if (projectId) params.projectId = projectId;
    if (userId) params.userId = userId;
    return params;
  }, [workspaceId, from, to, projectId, userId]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["timesheets", query],
    queryFn: () => fetchTimesheets(query),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows as TimesheetRow[];
    return (rows as TimesheetRow[]).filter((row) =>
      [
        row.userName,
        row.projectName,
        row.taskTitle,
        row.description,
        row.phaseName,
        row.sprintName,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const totalSeconds = filtered.reduce(
    (sum, row) => sum + (row.duration ?? 0),
    0,
  );

  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: "", rows: filtered }];
    const map = new Map<string, TimesheetRow[]>();
    for (const row of filtered) {
      let key = "";
      if (groupBy === "employee") key = row.userName ?? row.userId ?? "—";
      if (groupBy === "project") key = row.projectName ?? row.projectId;
      if (groupBy === "task")
        key = `${row.projectName ?? ""} · ${row.taskNumber ?? ""} ${row.taskTitle}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(row);
    }
    return [...map.entries()].map(([key, groupRows]) => ({
      key,
      label: key,
      rows: groupRows,
    }));
  }, [filtered, groupBy]);

  const exportCsv = () => {
    downloadCsv(
      `timesheets-${from}-${to}.csv`,
      [
        t("tasks:time.export.employee"),
        t("tasks:time.export.project"),
        t("tasks:time.export.phase"),
        t("tasks:time.export.sprint"),
        t("tasks:time.export.task"),
        t("tasks:time.export.workDate"),
        t("tasks:time.export.duration"),
        t("tasks:time.export.notes"),
        t("tasks:time.export.taskEstimate"),
        t("tasks:time.export.userAllocation"),
      ],
      filtered.map((row) => [
        row.userName ?? "",
        row.projectName ?? "",
        row.phaseName ?? "",
        row.sprintName ?? "",
        row.taskNumber != null
          ? `${row.taskNumber}. ${row.taskTitle}`
          : row.taskTitle,
        new Date(row.startTime).toISOString().slice(0, 10),
        formatSecondsAsHours(row.duration ?? 0),
        row.description ?? "",
        row.taskEstimatedMinutes != null
          ? formatSecondsAsHours(row.taskEstimatedMinutes * 60)
          : "",
        row.userAllocatedMinutes != null
          ? formatSecondsAsHours(row.userAllocatedMinutes * 60)
          : "",
      ]),
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterField label={t("tasks:time.export.from")}>
          <Input
            type="date"
            className="h-8"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </FilterField>
        <FilterField label={t("tasks:time.export.to")}>
          <Input
            type="date"
            className="h-8"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </FilterField>
        <FilterField label={t("tasks:time.export.project")}>
          <Select
            value={projectId || "__all"}
            onValueChange={(v) =>
              setProjectId(v === "__all" || v == null ? "" : v)
            }
          >
            <SelectTrigger className="h-8 w-44">
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
        </FilterField>
        <FilterField label={t("tasks:time.export.employee")}>
          <Select
            value={userId || "__all"}
            onValueChange={(v) =>
              setUserId(v === "__all" || v == null ? "" : v)
            }
          >
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">
                {t("tasks:time.export.allMembers")}
              </SelectItem>
              {users.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.user?.name ?? member.userId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label={t("tasks:time.export.groupBy")}>
          <Select
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as GroupBy)}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t("tasks:time.export.groupNone")}
              </SelectItem>
              <SelectItem value="employee">
                {t("tasks:time.export.employee")}
              </SelectItem>
              <SelectItem value="project">
                {t("tasks:time.export.project")}
              </SelectItem>
              <SelectItem value="task">
                {t("tasks:time.export.task")}
              </SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2 top-2 size-3.5 text-muted-foreground" />
          <Input
            className="h-8 pl-7"
            placeholder={t("tasks:time.export.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={exportCsv}>
          <Download className="size-3.5" />
          {t("tasks:time.export.csv")}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground tabular-nums">
        {t("tasks:time.export.total")}: {formatSecondsAsHours(totalSeconds)} ·{" "}
        {filtered.length} {t("tasks:time.export.entries")}
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          {t("common:empty.loading")}
        </p>
      ) : (
        grouped.map((group) => (
          <div key={group.key} className="space-y-2">
            {group.label ? (
              <h3 className="text-sm font-medium">{group.label}</h3>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tasks:time.export.employee")}</TableHead>
                  <TableHead>{t("tasks:time.export.project")}</TableHead>
                  <TableHead>{t("tasks:time.export.task")}</TableHead>
                  <TableHead>{t("tasks:time.export.workDate")}</TableHead>
                  <TableHead className="text-right">
                    {t("tasks:time.export.duration")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.userName ?? "—"}</TableCell>
                    <TableCell className="max-w-[10rem] truncate">
                      {row.projectName}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate">
                      {row.taskNumber != null ? `${row.taskNumber}. ` : ""}
                      {row.taskTitle}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {new Date(row.startTime).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSecondsAsHours(row.duration ?? 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))
      )}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
