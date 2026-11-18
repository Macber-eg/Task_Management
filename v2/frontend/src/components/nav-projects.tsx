import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  restrictToFirstScrollableAncestor,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import ProjectNavItem from "@/components/nav/project-nav-item";
import { type CSSProperties, type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsiblePanel } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import useDeleteProject from "@/hooks/mutations/project/use-delete-project";
import useReorderProjects from "@/hooks/mutations/project/use-reorder-projects";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import type { ProjectWithTasks } from "@/types/project";
import CreateProjectModal from "./shared/modals/create-project-modal";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

function SortableProjectItem({
  id,
  canReorder,
  children,
}: {
  id: string;
  canReorder: boolean;
  children: ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id,
      disabled: !canReorder,
      // The reorder already moves the row; animating the index change too
      // replays the same move from a stale offset.
      animateLayoutChanges: () => false,
      // dnd-kit defaults to `ease`; this is the app's curve.
      transition: { duration: 200, easing: "var(--ease-out)" },
    });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    // `listeners` without `attributes`: the latter puts role="button" and a tab
    // stop on the row, wrapping the link and the dropdown inside it.
    <SidebarMenuItem
      ref={setNodeRef}
      style={style}
      data-kaneo-sortable=""
      className={isDragging ? "opacity-0" : undefined}
      {...(canReorder ? listeners : {})}
    >
      {children}
    </SidebarMenuItem>
  );
}

export function NavProjects() {
  const { t } = useTranslation();
  const { isMobile } = useSidebar();
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects(
    {
      workspaceId: workspace?.id || "",
    },
    true,
  );
  const queryClient = useQueryClient();
  const { mutateAsync: deleteProject } = useDeleteProject();
  const reorderProjects = useReorderProjects();
  const { canCreateProjects, canDeleteProjects, canUpdateProjects } =
    useWorkspacePermission();
  const canCreate = canCreateProjects();
  const canDeleteProject = canDeleteProjects();
  // Matches the API, which gates /project/reorder on `project: ["update"]`
  // alone — not the create+update+delete bundle.
  const canReorder = canUpdateProjects();
  const navigate = useNavigate();
  const { workspaceId: currentWorkspaceId, projectId: currentProjectId } =
    useParams({
      strict: false,
    });
  const projectPathname = useLocation({
    select: (location) => location.pathname.replace(/\/+$/, ""),
  });
  const boardScope = useLocation({
    select: (location) => {
      const search = location.search as Record<string, unknown>;
      return {
        sprintId: typeof search.sprintId === "string" ? search.sprintId : null,
        phaseId: typeof search.phaseId === "string" ? search.phaseId : null,
        taskId: typeof search.taskId === "string" ? search.taskId : null,
      };
    },
  });

  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);
  const [isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] =
    useState(false);
  const [projectToDeleteId, setProjectToDeleteID] = useState<string | null>(
    null,
  );
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(
    null,
  );
  const [projectsSectionOpen, setProjectsSectionOpen] = useState(true);

  const draggingProject = projects?.find(
    (project) => project.id === draggingProjectId,
  );

  const isCurrentProject = (projectId: string) => {
    return (
      currentProjectId === projectId && currentWorkspaceId === workspace?.id
    );
  };

  const isProjectHome = (projectId: string) => {
    if (!workspace?.id) return false;
    const home = `/dashboard/workspace/${workspace.id}/project/${projectId}`;
    return projectPathname === home;
  };

  const projectPlanningEnabled = (project: ProjectWithTasks) =>
    !!project.phasesEnabled || !!project.sprintsEnabled;

  const handleProjectClick = (project: ProjectWithTasks) => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId",
      params: {
        workspaceId: workspace?.id || "",
        projectId: project.id,
      },
    });
  };

  // Below these thresholds the row is still a link and the sidebar still
  // scrolls; above them the gesture becomes a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    document.body.classList.add("kaneo-dragging");
    setDraggingProjectId(String(event.active.id));
  };

  const endDrag = () => {
    document.body.classList.remove("kaneo-dragging");
    setDraggingProjectId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    endDrag();

    if (!over || active.id === over.id || !projects || !workspace) return;

    const oldIndex = projects.findIndex((project) => project.id === active.id);
    const newIndex = projects.findIndex((project) => project.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(projects, oldIndex, newIndex);

    reorderProjects(workspace.id, reordered, {
      onError: () => {
        toast.error(t("workspace:projects.reorderError"));
      },
    });
  };

  if (!workspace) return null;

  return (
    <>
      <Collapsible
        open={projectsSectionOpen}
        onOpenChange={setProjectsSectionOpen}
        className="group/collapsible"
      >
        <SidebarGroup className="group-data-[collapsible=icon]:hidden gap-1 p-2 pt-1">
          <SidebarGroupLabel
            render={
              <button
                type="button"
                aria-expanded={projectsSectionOpen}
                onClick={() => setProjectsSectionOpen((open) => !open)}
                className="flex h-7 w-full cursor-pointer items-center justify-start gap-1 px-0 text-sidebar-accent-foreground"
              />
            }
          >
            <span>{t("navigation:sidebar.projects")}</span>
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-sidebar-foreground/60 transition-transform duration-200",
                projectsSectionOpen && "rotate-90",
              )}
            />
          </SidebarGroupLabel>
          {canCreate && (
            <SidebarGroupAction
              className="top-2 right-2 text-sidebar-foreground/70"
              title={t("navigation:projectList.addProject")}
              onClick={() => setIsCreateProjectModalOpen(true)}
            >
              <Plus />
              <span className="sr-only">
                {t("navigation:projectList.addProject")}
              </span>
            </SidebarGroupAction>
          )}
          <CollapsiblePanel>
            <SidebarGroupContent>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[
                  restrictToVerticalAxis,
                  restrictToFirstScrollableAncestor,
                ]}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={endDrag}
              >
                <SidebarMenu className="gap-0.5">
                  <SortableContext
                    items={projects?.map((project) => project.id) ?? []}
                    strategy={verticalListSortingStrategy}
                  >
                    {projects?.map((project) => (
                      <SortableProjectItem
                        key={project.id}
                        id={project.id}
                        canReorder={canReorder}
                      >
                        <ProjectNavItem
                          project={project}
                          workspaceId={workspace.id}
                          isCurrentProject={isCurrentProject(project.id)}
                          planningEnabled={projectPlanningEnabled(project)}
                          isProjectHome={isProjectHome(project.id)}
                          activeSprintId={
                            isCurrentProject(project.id) &&
                            !isProjectHome(project.id)
                              ? boardScope.sprintId
                              : null
                          }
                          activePhaseId={
                            isCurrentProject(project.id) &&
                            !isProjectHome(project.id)
                              ? boardScope.phaseId
                              : null
                          }
                          isMobile={isMobile}
                          canDeleteProject={canDeleteProject}
                          onBoard={() => handleProjectClick(project)}
                          onDelete={() => {
                            setProjectToDeleteID(project.id);
                            setIsDeleteProjectModalOpen(true);
                          }}
                        />
                      </SortableProjectItem>
                    ))}
                  </SortableContext>
                </SidebarMenu>

                {/* Portalled: `SidebarContent` is `overflow-auto` and clips it. */}
                {createPortal(
                  <DragOverlay dropAnimation={null}>
                    {draggingProject ? (
                      <div className="flex h-8 w-(--sidebar-width) max-w-64 items-center rounded-lg border bg-sidebar not-dark:bg-clip-padding px-2 text-sm text-sidebar-accent-foreground shadow-lg/5">
                        <span className="truncate">{draggingProject.name}</span>
                      </div>
                    ) : null}
                  </DragOverlay>,
                  document.body,
                )}
              </DndContext>
            </SidebarGroupContent>
          </CollapsiblePanel>
        </SidebarGroup>
      </Collapsible>

      <CreateProjectModal
        open={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
      />

      <AlertDialog
        open={isDeleteProjectModalOpen}
        onOpenChange={setIsDeleteProjectModalOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("navigation:projectList.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("navigation:projectList.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await deleteProject({
                      id: projectToDeleteId || "",
                    });
                    toast.success(t("navigation:projectList.deletedToast"));
                    queryClient.invalidateQueries({
                      queryKey: ["projects"],
                    });
                    navigate({
                      to: "/dashboard/workspace/$workspaceId",
                      params: {
                        workspaceId: workspace?.id || "",
                      },
                    });
                  }}
                />
              }
            >
              {t("navigation:projectList.deleteProject")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
