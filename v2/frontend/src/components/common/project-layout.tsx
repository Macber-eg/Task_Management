import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  CalendarRange,
  Clock3,
  Home,
  Layers,
  SquareKanban,
  SquircleDashed,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import MobileProjectNav from "@/components/common/header/mobile-project-nav";
import ProjectCrumbSelect from "@/components/common/header/project-crumb-select";
import WorkspaceCrumbSelect from "@/components/common/header/workspace-crumb-select";
import Layout from "@/components/common/layout";
import CreateProjectModal from "@/components/shared/modals/create-project-modal";
import { Button } from "@/components/ui/button";
import { KbdSequence } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shortcuts } from "@/constants/shortcuts";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";
import { cn } from "@/lib/cn";
import { getProjectUnavailableReason } from "@/lib/project-unavailable-reason";
import { useBackgroundStore } from "@/store/background";
import ProjectHierarchyBreadcrumb from "./project-hierarchy-breadcrumb";
import ProjectUnavailable from "./project-unavailable";

type ProjectLayoutProps = {
  projectId: string;
  workspaceId: string;
  headerActions?: ReactNode;
  children: ReactNode;
  showViewSwitcher?: boolean;
  activeView?:
    | "backlog"
    | "board"
    | "calendar"
    | "gantt"
    | "home"
    | "planning"
    | "time-analytics";
};

export default function ProjectLayout({
  projectId,
  workspaceId,
  headerActions,
  children,
  showViewSwitcher = true,
  activeView,
}: ProjectLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: project, error: projectError } = useGetProject({
    id: projectId,
    workspaceId,
  });
  const unavailableReason = getProjectUnavailableReason(projectError);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);
  const { background } = useBackgroundStore();

  useProjectWebSocket(unavailableReason ? "" : projectId);

  const projectBasePath = `/dashboard/workspace/${workspaceId}/project/${projectId}`;
  const isProjectHomePath =
    location.pathname.replace(/\/+$/, "") === projectBasePath;

  const resolvedView =
    activeView ??
    (isProjectHomePath
      ? "home"
      : location.pathname.includes("/backlog")
        ? "backlog"
        : location.pathname.includes("/calendar")
          ? "calendar"
          : location.pathname.includes("/gantt")
            ? "gantt"
            : location.pathname.includes("/planning")
              ? "planning"
              : location.pathname.includes("/time-analytics")
                ? "time-analytics"
                : "board");

  const handleNavigateToHome = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId",
      params: { workspaceId, projectId },
    });
  };

  const handleNavigateToBacklog = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/backlog",
      params: { workspaceId, projectId },
    });
  };

  const handleNavigateToBoard = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId },
    });
  };

  const handleNavigateToCalendar = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
      params: { workspaceId, projectId },
    });
  };

  const handleNavigateToGantt = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
      params: { workspaceId, projectId },
    });
  };

  const handleNavigateToPlanning = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/planning",
      params: { workspaceId, projectId },
    });
  };

  const handleNavigateToTimeAnalytics = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/time-analytics",
      params: { workspaceId, projectId },
    });
  };

  const handleProjectSwitch = (nextProjectId: string) => {
    navigate({
      to:
        resolvedView === "home"
          ? "/dashboard/workspace/$workspaceId/project/$projectId"
          : resolvedView === "backlog"
            ? "/dashboard/workspace/$workspaceId/project/$projectId/backlog"
            : resolvedView === "calendar"
              ? "/dashboard/workspace/$workspaceId/project/$projectId/calendar"
              : resolvedView === "gantt"
                ? "/dashboard/workspace/$workspaceId/project/$projectId/gantt"
                : resolvedView === "planning"
                  ? "/dashboard/workspace/$workspaceId/project/$projectId/planning"
                  : resolvedView === "time-analytics"
                    ? "/dashboard/workspace/$workspaceId/project/$projectId/time-analytics"
                    : "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: {
        workspaceId,
        projectId: nextProjectId,
      },
    });
  };

  return (
    <Layout>
      <Layout.Header
        className={cn("h-11 border-border/80 px-2", {
          "bg-card/90 backdrop-blur": !!background,
        })}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger className="-ml-1 h-7 w-7 cursor-pointer text-foreground/85 hover:text-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="flex items-center gap-2 text-[10px]">
                    {t("navigation:settingsLayout.toggleSidebar")}
                    <KbdSequence
                      keys={[
                        shortcuts.sidebar.prefix,
                        shortcuts.sidebar.toggle,
                      ]}
                    />
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="h-4 w-px shrink-0 bg-border/80" />

            <div className="hidden min-w-0 items-center gap-1 md:flex">
              <WorkspaceCrumbSelect />
              <span className="text-foreground/30 text-xs">/</span>
              <ProjectCrumbSelect
                workspaceId={workspaceId}
                projectId={projectId}
                projectName={project?.name}
                onSelectProject={handleProjectSwitch}
                onAddProject={() => setIsCreateProjectModalOpen(true)}
              />
            </div>

            <div className="min-w-0 md:hidden">
              <MobileProjectNav
                workspaceId={workspaceId}
                projectId={projectId}
                projectName={project?.name}
                activeView={resolvedView}
                onSelectHome={handleNavigateToHome}
                onSelectBacklog={handleNavigateToBacklog}
                onSelectBoard={handleNavigateToBoard}
                onSelectCalendar={handleNavigateToCalendar}
                onSelectGantt={handleNavigateToGantt}
                onSelectPlanning={handleNavigateToPlanning}
                onSelectProject={handleProjectSwitch}
                onAddProject={() => setIsCreateProjectModalOpen(true)}
              />
            </div>

            {showViewSwitcher && !unavailableReason && (
              <div className="hidden h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5 sm:inline-flex">
                <Button
                  variant={resolvedView === "home" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToHome}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "home" && "text-muted-foreground",
                  )}
                >
                  <Home className="size-3.5" />
                  {t("navigation:sidebar.home")}
                </Button>
                <Button
                  variant={resolvedView === "backlog" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToBacklog}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "backlog" && "text-muted-foreground",
                  )}
                >
                  <SquircleDashed className="size-3.5" />
                  {t("tasks:view.backlog")}
                </Button>
                <Button
                  variant={resolvedView === "board" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToBoard}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "board" && "text-muted-foreground",
                  )}
                >
                  <SquareKanban className="size-3.5" />
                  {t("tasks:title")}
                </Button>
                <Button
                  variant={resolvedView === "calendar" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToCalendar}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "calendar" && "text-muted-foreground",
                  )}
                >
                  <CalendarRange className="size-3.5" />
                  {t("tasks:calendar.title")}
                </Button>
                <Button
                  variant={resolvedView === "gantt" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToGantt}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "gantt" && "text-muted-foreground",
                  )}
                >
                  <CalendarDays className="size-3.5" />
                  {t("tasks:view.gantt")}
                </Button>
                <Button
                  variant={resolvedView === "planning" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToPlanning}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "planning" && "text-muted-foreground",
                  )}
                >
                  <Layers className="size-3.5" />
                  {t("tasks:view.planning")}
                </Button>
                <Button
                  variant={
                    resolvedView === "time-analytics" ? "secondary" : "ghost"
                  }
                  size="xs"
                  onClick={handleNavigateToTimeAnalytics}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "time-analytics" &&
                      "text-muted-foreground",
                  )}
                >
                  <Clock3 className="size-3.5" />
                  {t("tasks:time.nav")}
                </Button>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {unavailableReason ? null : headerActions}
          </div>
        </div>
      </Layout.Header>

      <Layout.Content>
        {unavailableReason ? (
          <ProjectUnavailable
            reason={unavailableReason}
            workspaceId={workspaceId}
          />
        ) : (
          <>
            <ProjectHierarchyBreadcrumb
              workspaceId={workspaceId}
              projectId={projectId}
            />
            {children}
          </>
        )}
      </Layout.Content>

      <CreateProjectModal
        open={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
      />
    </Layout>
  );
}
