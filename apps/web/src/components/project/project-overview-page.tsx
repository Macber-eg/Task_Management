import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Bookmark,
  ExternalLink,
  FileText,
  Folder,
  ListChecks,
  Plus,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import PlanningQuickAddPopover from "@/components/nav/planning-quick-add-popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import {
  createProjectBookmark,
  deleteProjectBookmark,
  fetchProjectBookmarks,
  fetchProjectHomeAssets,
  fetchProjectRecent,
} from "@/fetchers/project-home/project-home-api";
import { getApiUrl } from "@/fetchers/get-api-url";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useGetPhases } from "@/hooks/queries/planning/use-get-phases";
import { useGetSprints } from "@/hooks/queries/planning/use-get-sprints";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { getColumnIcon } from "@/lib/column";
import { recordProjectRecentItem } from "@/lib/record-project-recent";
import { formatSecondsAsHours } from "@/lib/time-metrics";

type ProjectOverviewPageProps = {
  workspaceId: string;
  projectId: string;
};

function rootPhases(phases: ReturnType<typeof useGetPhases>["data"]) {
  return (phases ?? []).filter(
    (phase) =>
      (phase.kind ?? "folder") !== "document" &&
      (phase.parentId ?? null) === null,
  );
}

export default function ProjectOverviewPage({
  workspaceId,
  projectId,
}: ProjectOverviewPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: phases = [] } = useGetPhases(projectId, true);
  const { data: sprints = [] } = useGetSprints(projectId, true);
  const { data: board } = useGetTasks(projectId);
  const { data: columns = [] } = useGetColumns(projectId);

  const { data: recent = [] } = useQuery({
    queryKey: ["project-recent", projectId],
    queryFn: () => fetchProjectRecent(projectId),
  });
  const { data: bookmarks = [] } = useQuery({
    queryKey: ["project-bookmarks", projectId],
    queryFn: () => fetchProjectBookmarks(projectId),
  });
  const { data: assets = [] } = useQuery({
    queryKey: ["project-home-assets", projectId],
    queryFn: () => fetchProjectHomeAssets(projectId),
  });
  const { data: timeReport } = useQuery({
    queryKey: ["time-analytics", projectId],
    queryFn: () => fetchProjectTimeReport(projectId),
  });

  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkUrl, setBookmarkUrl] = useState("");
  const [showAllSprints, setShowAllSprints] = useState(false);

  const documents = useMemo(
    () => phases.filter((phase) => phase.kind === "document"),
    [phases],
  );
  const folderPhases = useMemo(() => rootPhases(phases), [phases]);

  const allTasks = useMemo(() => {
    if (!board) return [];
    return [
      ...board.columns.flatMap((col) => col.tasks),
      ...board.plannedTasks,
      ...board.archivedTasks,
    ];
  }, [board]);

  const finalSlugs = useMemo(
    () => new Set(columns.filter((c) => c.isFinal).map((c) => c.slug)),
    [columns],
  );

  const statusCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of allTasks) {
      map.set(task.status, (map.get(task.status) ?? 0) + 1);
    }
    return columns.map((column) => ({
      slug: column.slug,
      name: column.name,
      color: column.color,
      icon: column.icon,
      isFinal: column.isFinal,
      count: map.get(column.slug) ?? 0,
    }));
  }, [allTasks, columns]);

  const sprintsByPhase = useMemo(() => {
    const map = new Map<string, number>();
    for (const sprint of sprints) {
      const key = sprint.phaseId ?? "";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [sprints]);

  const sprintRows = useMemo(() => {
    return sprints.map((sprint) => {
      const tasks = allTasks.filter((task) => task.sprintId === sprint.id);
      const completed = tasks.filter((task) =>
        finalSlugs.has(task.status),
      ).length;
      const phase = phases.find((p) => p.id === sprint.phaseId);
      return { sprint, tasks, completed, phaseName: phase?.name ?? "—" };
    });
  }, [sprints, allTasks, phases, finalSlugs]);

  const visibleSprints = showAllSprints ? sprintRows : sprintRows.slice(0, 12);

  const openPhase = (phaseId: string, name: string) => {
    recordProjectRecentItem(projectId, {
      itemType: "phase",
      itemId: phaseId,
      title: name,
      parentLabel: project?.name,
    });
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId },
      search: { phaseId },
    });
  };

  const openSprint = (sprintId: string, name: string, phaseName?: string) => {
    recordProjectRecentItem(projectId, {
      itemType: "sprint",
      itemId: sprintId,
      title: name,
      parentLabel: phaseName ? `${phaseName}` : project?.name,
    });
    const sprint = sprints.find((s) => s.id === sprintId);
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId },
      search: { sprintId, phaseId: sprint?.phaseId ?? undefined },
    });
  };

  const openDocument = (phaseId: string, name: string) => {
    recordProjectRecentItem(projectId, {
      itemType: "document",
      itemId: phaseId,
      title: name,
      parentLabel: project?.name,
    });
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/document",
      params: { workspaceId, projectId },
      search: { phaseId },
    });
  };

  const openRecent = (item: (typeof recent)[number]) => {
    if (item.itemType === "phase") openPhase(item.itemId, item.title);
    else if (item.itemType === "sprint")
      openSprint(item.itemId, item.title, item.parentLabel ?? undefined);
    else if (item.itemType === "document")
      openDocument(item.itemId, item.title);
    else if (item.itemType === "task") {
      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
        params: { workspaceId, projectId },
        search: { taskId: item.itemId },
      });
    }
  };

  const saveBookmark = async () => {
    if (!bookmarkTitle.trim() || !bookmarkUrl.trim()) return;
    await createProjectBookmark(projectId, {
      title: bookmarkTitle.trim(),
      url: bookmarkUrl.trim(),
    });
    await queryClient.invalidateQueries({
      queryKey: ["project-bookmarks", projectId],
    });
    setBookmarkOpen(false);
    setBookmarkTitle("");
    setBookmarkUrl("");
  };

  const completionPct = useMemo(() => {
    if (allTasks.length === 0) return 0;
    const completed = allTasks.filter((task) =>
      finalSlugs.has(task.status),
    ).length;
    return Math.round((completed / allTasks.length) * 100);
  }, [allTasks, finalSlugs]);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-5">
      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {t("projectHome:timeSummary.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-3 text-sm">
          <div className="flex flex-wrap gap-4 tabular-nums">
            <Metric
              label={t("tasks:time.totalEstimate")}
              value={
                timeReport
                  ? formatSecondsAsHours(timeReport.estimatedMinutes * 60)
                  : "—"
              }
            />
            <Metric
              label={t("tasks:time.totalActual")}
              value={
                timeReport
                  ? formatSecondsAsHours(timeReport.actualSeconds)
                  : "—"
              }
            />
            <Metric
              label={t("projectHome:timeSummary.variance")}
              value={
                timeReport
                  ? formatSecondsAsHours(
                      Math.abs(timeReport.varianceMinutes) * 60,
                    )
                  : "—"
              }
            />
            <Metric
              label={t("projectHome:timeSummary.completion")}
              value={`${completionPct}%`}
            />
            {timeReport ? (
              <Metric
                label={t("tasks:time.tasksOverEstimate")}
                value={String(timeReport.tasksOverEstimate)}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/time-analytics",
                  params: { workspaceId, projectId },
                })
              }
            >
              {t("projectHome:timeSummary.detailedReport")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/workload",
                  params: { workspaceId },
                  search: { projectId },
                })
              }
            >
              {t("projectHome:resourceWorkload")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <HomeCard title={t("projectHome:recent.title")} className="max-h-64">
          {recent.length === 0 ? (
            <EmptyHint text={t("projectHome:recent.empty")} />
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto text-sm">
              {recent.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60"
                    onClick={() => openRecent(item)}
                  >
                    <RecentIcon type={item.itemType} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {item.title}
                      </span>
                      {item.parentLabel ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {t("projectHome:inParent", {
                            parent: item.parentLabel,
                          })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </HomeCard>

        <HomeCard title={t("projectHome:docs.title")} className="max-h-64">
          {documents.length === 0 ? (
            <EmptyHint text={t("projectHome:docs.empty")} />
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto text-sm">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60"
                    onClick={() => openDocument(doc.id, doc.name)}
                  >
                    <FileText className="size-4 shrink-0 text-blue-600" />
                    <span className="truncate">{doc.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </HomeCard>

        <HomeCard title={t("projectHome:bookmarks.title")} className="max-h-64">
          {bookmarks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center text-sm text-muted-foreground">
              <Bookmark className="size-8 opacity-40" />
              <p className="max-w-[14rem] text-xs">
                {t("projectHome:bookmarks.empty")}
              </p>
              <Button size="sm" onClick={() => setBookmarkOpen(true)}>
                {t("projectHome:bookmarks.add")}
              </Button>
            </div>
          ) : (
            <>
              <ul className="max-h-36 space-y-1 overflow-y-auto text-sm">
                {bookmarks.map((bm) => (
                  <li key={bm.id} className="flex items-center gap-1">
                    <a
                      href={bm.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 flex-1 items-center gap-1 truncate hover:underline"
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      {bm.title}
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1 text-xs"
                      onClick={() =>
                        void deleteProjectBookmark(bm.id).then(() =>
                          queryClient.invalidateQueries({
                            queryKey: ["project-bookmarks", projectId],
                          }),
                        )
                      }
                    >
                      ×
                    </Button>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => setBookmarkOpen(true)}
              >
                <Plus className="size-3.5" />
                {t("projectHome:bookmarks.add")}
              </Button>
            </>
          )}
        </HomeCard>
      </div>

      <HomeCard
        title={t("projectHome:phases.title")}
        action={project ? <PlanningQuickAddPopover project={project} /> : null}
      >
        {folderPhases.length === 0 ? (
          <EmptyHint text={t("projectHome:phases.empty")} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {folderPhases.map((phase) => (
              <button
                key={phase.id}
                type="button"
                onClick={() => openPhase(phase.id, phase.name)}
                className="flex items-center gap-2 rounded-lg border border-border/80 bg-card px-3 py-2.5 text-left text-sm hover:bg-muted/40"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {phase.name}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {sprintsByPhase.get(phase.id) ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}
      </HomeCard>

      <HomeCard title={t("projectHome:sprints.title")}>
        {sprintRows.length === 0 ? (
          <EmptyHint text={t("projectHome:sprints.empty")} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("projectHome:sprints.name")}</TableHead>
                  <TableHead>{t("projectHome:sprints.phase")}</TableHead>
                  <TableHead>{t("projectHome:sprints.progress")}</TableHead>
                  <TableHead>{t("tasks:planning.startDate")}</TableHead>
                  <TableHead>{t("tasks:planning.endDate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleSprints.map(
                  ({ sprint, tasks, completed, phaseName }) => {
                    const total = tasks.length;
                    const pct = total > 0 ? (completed / total) * 100 : 0;
                    return (
                      <TableRow
                        key={sprint.id}
                        className="cursor-pointer"
                        onClick={() =>
                          openSprint(sprint.id, sprint.name, phaseName)
                        }
                      >
                        <TableCell className="font-medium">
                          {sprint.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {phaseName}
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-[7rem] items-center gap-2">
                            <Progress value={pct} className="h-1.5 flex-1" />
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {completed}/{total}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">
                          {sprint.startDate?.slice(0, 10) ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">
                          {sprint.endDate?.slice(0, 10) ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  },
                )}
              </TableBody>
            </Table>
            {sprintRows.length > 12 ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setShowAllSprints((v) => !v)}
              >
                {showAllSprints
                  ? t("projectHome:showLess")
                  : t("projectHome:viewAll")}
              </Button>
            ) : null}
          </>
        )}
      </HomeCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <HomeCard title={t("projectHome:resources.title")}>
          {assets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              <Upload className="size-8 opacity-40" />
              <p>{t("projectHome:resources.empty")}</p>
            </div>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
              {assets.map((asset) => (
                <li
                  key={asset.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">{asset.filename}</span>
                  <a
                    className="shrink-0 text-xs text-primary hover:underline"
                    href={getApiUrl(`asset/${asset.id}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("projectHome:resources.download")}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </HomeCard>

        <HomeCard title={t("projectHome:workloadByStatus.title")}>
          {allTasks.length === 0 ? (
            <EmptyHint text={t("projectHome:workloadByStatus.empty")} />
          ) : (
            <ul className="space-y-2">
              {statusCounts.map((column) => (
                <li key={column.slug}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
                    onClick={() =>
                      navigate({
                        to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
                        params: { workspaceId, projectId },
                      })
                    }
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      {getColumnIcon(column.slug, column.isFinal, column.icon)}
                      <span className="truncate">{column.name}</span>
                    </span>
                    <span className="text-sm font-medium tabular-nums">
                      {column.count}
                    </span>
                  </button>
                </li>
              ))}
              <li className="pt-1 text-xs text-muted-foreground">
                {t("projectHome:workloadByStatus.total", {
                  count: allTasks.length,
                })}
              </li>
            </ul>
          )}
        </HomeCard>
      </div>

      <Dialog open={bookmarkOpen} onOpenChange={setBookmarkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projectHome:bookmarks.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              placeholder={t("projectHome:bookmarks.titlePlaceholder")}
              value={bookmarkTitle}
              onChange={(e) => setBookmarkTitle(e.target.value)}
            />
            <Input
              placeholder="https://"
              value={bookmarkUrl}
              onChange={(e) => setBookmarkUrl(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => void saveBookmark()}>
              {t("projectHome:bookmarks.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HomeCard({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-border/80 shadow-sm ${className ?? ""}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
  );
}

function RecentIcon({ type }: { type: string }) {
  if (type === "document")
    return <FileText className="mt-0.5 size-4 shrink-0 text-blue-600" />;
  if (type === "sprint")
    return (
      <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    );
  if (type === "task") return <ListChecks className="mt-0.5 size-4 shrink-0" />;
  return <Folder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}
