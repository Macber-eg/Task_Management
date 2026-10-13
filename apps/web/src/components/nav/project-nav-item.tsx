import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  Folder,
  Forward,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import HierarchyInlineRename from "@/components/nav/hierarchy-inline-rename";
import PlanningQuickAddPopover from "@/components/nav/planning-quick-add-popover";
import ProjectPlanningSidebarTree from "@/components/nav/project-planning-sidebar-tree";
import { ProjectProgress } from "@/components/project-progress";
import { Collapsible, CollapsiblePanel } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import icons from "@/constants/project-icons";
import { cn } from "@/lib/cn";
import { formatPlanningRange } from "@/lib/planning-dates";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import { toast } from "@/lib/toast";
import type { ProjectWithTasks } from "@/types/project";

type ProjectNavItemProps = {
  project: ProjectWithTasks;
  workspaceId: string;
  isCurrentProject: boolean;
  isProjectHome: boolean;
  planningEnabled: boolean;
  activeSprintId: string | null;
  activePhaseId: string | null;
  isMobile: boolean;
  canDeleteProject: boolean;
  onDelete: () => void;
  onBoard: () => void;
};

export default function ProjectNavItem({
  project,
  workspaceId,
  isCurrentProject,
  isProjectHome,
  planningEnabled,
  activeSprintId,
  activePhaseId,
  isMobile,
  canDeleteProject,
  onDelete,
  onBoard,
}: ProjectNavItemProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mutateAsync: updateProject } = useUpdateProject();
  const [open, setOpen] = useState(isCurrentProject && planningEnabled);
  const [renamingProject, setRenamingProject] = useState(false);
  const ProjectIcon = icons[project.icon as keyof typeof icons] || icons.Layout;
  const projectDates = formatPlanningRange(
    project.startDate ?? null,
    project.endDate ?? null,
  );

  useEffect(() => {
    if (isCurrentProject && planningEnabled) {
      setOpen(true);
    }
  }, [isCurrentProject, planningEnabled]);

  const renameProject = async (name: string) => {
    try {
      await updateProject({
        id: project.id,
        name,
        slug: project.slug,
        description: project.description ?? "",
        icon: project.icon ?? "Layout",
        isPublic: !!project.isPublic,
        phasesEnabled: !!project.phasesEnabled,
        sprintsEnabled: !!project.sprintsEnabled,
        startDate: project.startDate ?? null,
        endDate: project.endDate ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({
        queryKey: ["project", project.id],
      });
      toast.success(t("navigation:projectList.projectRenamed"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.updateError"),
      );
    }
  };

  const openProjectSettings = () => {
    navigate({
      to: "/dashboard/settings/projects/$projectId/general",
      params: { projectId: project.id },
    });
  };

  const header = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {planningEnabled ? (
          <button
            type="button"
            aria-expanded={open}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                open && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" />
        )}
        <SidebarMenuButton
          isActive={isCurrentProject && isProjectHome}
          size="default"
          className={cn(
            "min-w-0 flex-1 px-1.5 text-sm",
            planningEnabled && projectDates ? "h-auto min-h-8 py-1" : "h-8",
          )}
          onClick={onBoard}
        >
          <ProjectIcon aria-hidden="true" />
          <span className="min-w-0 flex-1 text-left">
            <HierarchyInlineRename
              className="block truncate text-sm font-medium"
              value={project.name}
              editing={renamingProject}
              onEditingChange={setRenamingProject}
              onCommit={renameProject}
            />
            {planningEnabled && projectDates ? (
              <span className="block truncate text-[10px] font-normal text-muted-foreground">
                {projectDates}
              </span>
            ) : null}
          </span>
          {"statistics" in project &&
          project.statistics &&
          typeof project.statistics === "object" &&
          "completionPercentage" in project.statistics ? (
            <ProjectProgress
              percentage={
                (project.statistics as { completionPercentage: number })
                  .completionPercentage
              }
              className="text-muted-foreground max-md:hidden group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0 group-has-data-[state=open]/menu-item:opacity-0"
            />
          ) : null}
        </SidebarMenuButton>
        {planningEnabled && project.phasesEnabled ? (
          <PlanningQuickAddPopover
            project={project}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover/project-tree:opacity-100"
          />
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              className="absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground after:-inset-2 after:absolute md:after:hidden peer-data-[size=sm]/menu-button:top-1 peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 group-data-[collapsible=icon]:hidden group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0"
            />
          }
        >
          <MoreHorizontal />
          <span className="sr-only">{t("navigation:sidebar.more")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-44 rounded-lg"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem
            className="h-7 cursor-pointer items-start text-sm"
            onClick={onBoard}
          >
            <Folder className="text-muted-foreground" />
            <span>{t("navigation:projectList.viewProject")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-7 cursor-pointer items-start text-sm"
            onClick={() => {
              navigator.clipboard.writeText(
                `${window.location.origin}/dashboard/workspace/${workspaceId}/project/${project.id}`,
              );
              toast.success(t("navigation:projectList.linkCopied"));
            }}
          >
            <Forward className="text-muted-foreground" />
            <span>{t("navigation:projectList.shareProject")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-7 cursor-pointer items-start text-sm"
            onClick={() => setRenamingProject(true)}
          >
            <Pencil className="text-muted-foreground" />
            <span>{t("tasks:planning.rename")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-7 cursor-pointer items-start text-sm"
            onClick={openProjectSettings}
          >
            <Settings className="text-muted-foreground" />
            <span>{t("navigation:projectList.projectSettings")}</span>
          </DropdownMenuItem>
          {canDeleteProject && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="h-7 cursor-pointer items-start text-sm text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="text-destructive" />
                <span>{t("navigation:projectList.deleteProject")}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  if (!planningEnabled) {
    return header;
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/project-tree"
    >
      {header}
      <CollapsiblePanel>
        <ProjectPlanningSidebarTree
          project={project}
          workspaceId={workspaceId}
          activeSprintId={activeSprintId}
          activePhaseId={activePhaseId}
        />
      </CollapsiblePanel>
    </Collapsible>
  );
}
