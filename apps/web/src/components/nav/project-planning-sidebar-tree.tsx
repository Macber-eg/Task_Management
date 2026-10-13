import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  Copy,
  Folder,
  GripVertical,
  Layers,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import HierarchyInlineRename from "@/components/nav/hierarchy-inline-rename";
import PlanningDatesPopover from "@/components/nav/planning-dates-popover";
import PlanningQuickAddPopover from "@/components/nav/planning-quick-add-popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ProjectPhase,
  ProjectSprint,
} from "@/fetchers/planning/planning-api";
import {
  deletePhaseById,
  deleteSprintById,
  patchPhase,
  patchSprint,
  postPhase,
  postSprint,
  reorderPhases,
  reorderSprints,
} from "@/fetchers/planning/planning-api";
import { useGetPhases } from "@/hooks/queries/planning/use-get-phases";
import { useGetSprints } from "@/hooks/queries/planning/use-get-sprints";
import {
  parseSortableId,
  reorderById,
  sortableId,
  toPositionPayload,
} from "@/lib/hierarchy-reorder";
import {
  readExpandedIds,
  toggleExpandedId,
  writeExpandedIds,
} from "@/lib/hierarchy-sidebar-prefs";
import { cn } from "@/lib/cn";
import { recordProjectRecentItem } from "@/lib/record-project-recent";
import { toast } from "@/lib/toast";
import type { ProjectWithTasks } from "@/types/project";

type ProjectPlanningSidebarTreeProps = {
  project: ProjectWithTasks;
  workspaceId: string;
  activeSprintId: string | null;
  activePhaseId: string | null;
};

function TruncatedLabel({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="block truncate" />}>
        {text}
      </TooltipTrigger>
      <TooltipContent side="right">{text}</TooltipContent>
    </Tooltip>
  );
}

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: (handle: {
    listeners: ReturnType<typeof useSortable>["listeners"];
    attributes: ReturnType<typeof useSortable>["attributes"];
  }) => ReactNode;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    listeners,
    attributes,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {children({ listeners, attributes })}
    </div>
  );
}

/** Root-level folder phases only (no documents, no nested subfolders in the sidebar). */
function listSidebarPhases(phases: ProjectPhase[]): ProjectPhase[] {
  return phases
    .filter(
      (phase) =>
        (phase.kind ?? "folder") !== "document" &&
        (phase.parentId ?? null) === null,
    )
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export default function ProjectPlanningSidebarTree({
  project,
  workspaceId,
  activeSprintId,
  activePhaseId,
}: ProjectPlanningSidebarTreeProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const phasesEnabled = !!project.phasesEnabled;
  const sprintsEnabled = !!project.sprintsEnabled;
  const { data: phases = [] } = useGetPhases(project.id, phasesEnabled);
  const { data: sprints = [] } = useGetSprints(project.id, sprintsEnabled);

  const sidebarPhases = useMemo(() => listSidebarPhases(phases), [phases]);

  const sortableIds = useMemo(
    () => [
      ...sidebarPhases.map((phase) => sortableId("phase", phase.id)),
      ...sprints.map((sprint) => sortableId("sprint", sprint.id)),
    ],
    [sidebarPhases, sprints],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    readExpandedIds(project.id),
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);

  useEffect(() => {
    const stored = readExpandedIds(project.id);
    const seed = new Set(stored);
    if (activePhaseId) seed.add(activePhaseId);
    if (activeSprintId) {
      seed.add(activeSprintId);
      const sprint = sprints.find((item) => item.id === activeSprintId);
      if (sprint?.phaseId) seed.add(sprint.phaseId);
    }
    setExpandedIds(seed);
    writeExpandedIds(project.id, seed);
  }, [project.id, activePhaseId, activeSprintId, sprints]);

  const sprintsByPhase = useMemo(() => {
    const map = new Map<string, ProjectSprint[]>();
    for (const sprint of sprints) {
      const key = sprint.phaseId ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(sprint);
    }
    for (const [, list] of map) {
      list.sort(
        (a, b) => a.position - b.position || a.name.localeCompare(b.name),
      );
    }
    return map;
  }, [sprints]);

  const setExpanded = useCallback(
    (id: string, open: boolean) => {
      setExpandedIds(toggleExpandedId(project.id, id, open));
    },
    [project.id],
  );

  const openSprintWorkspace = (sprint: ProjectSprint) => {
    const phase = phases.find((item) => item.id === sprint.phaseId);
    recordProjectRecentItem(project.id, {
      itemType: "sprint",
      itemId: sprint.id,
      title: sprint.name,
      parentLabel: phase?.name ?? project.name,
    });
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId: project.id },
      search: {
        sprintId: sprint.id,
        phaseId: sprint.phaseId ?? undefined,
      },
    });
  };

  const openPhaseView = (phase: ProjectPhase) => {
    recordProjectRecentItem(project.id, {
      itemType: "phase",
      itemId: phase.id,
      title: phase.name,
      parentLabel: project.name,
    });
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId: project.id },
      search: { phaseId: phase.id },
    });
  };

  const openPlanningSettings = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/planning",
      params: { workspaceId, projectId: project.id },
    });
  };

  const invalidatePlanning = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["phases", project.id] }),
      queryClient.invalidateQueries({ queryKey: ["sprints", project.id] }),
    ]);
  };

  const renamePhase = async (id: string, name: string) => {
    await patchPhase(id, { name });
    await invalidatePlanning();
    toast.success(t("tasks:planning.phaseRenamed"));
  };

  const renameSprint = async (id: string, name: string) => {
    await patchSprint(id, { name });
    await invalidatePlanning();
    toast.success(t("tasks:planning.sprintRenamed"));
  };

  const duplicatePhase = async (phase: ProjectPhase) => {
    try {
      await postPhase(project.id, {
        name: `${phase.name} (${t("tasks:planning.copySuffix")})`,
        parentId: null,
        kind: "folder",
        startDate: phase.startDate,
        endDate: phase.endDate,
      });
      await invalidatePlanning();
      toast.success(t("tasks:planning.phaseDuplicated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.createError"),
      );
    }
  };

  const duplicateSprint = async (sprint: ProjectSprint) => {
    try {
      await postSprint(project.id, {
        name: `${sprint.name} (${t("tasks:planning.copySuffix")})`,
        phaseId: sprint.phaseId,
        goal: sprint.goal,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      });
      await invalidatePlanning();
      toast.success(t("tasks:planning.sprintDuplicated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.createError"),
      );
    }
  };

  const archivePhase = async (phase: ProjectPhase) => {
    try {
      await patchPhase(phase.id, { archived: true });
      await invalidatePlanning();
      toast.success(t("tasks:planning.phaseArchived"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.updateError"),
      );
    }
  };

  const deletePhase = async (phase: ProjectPhase) => {
    if (!window.confirm(t("tasks:planning.deletePhaseConfirm"))) return;
    try {
      await deletePhaseById(phase.id);
      await invalidatePlanning();
      toast.success(t("tasks:planning.phaseDeleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.deleteError"),
      );
    }
  };

  const deleteSprint = async (sprint: ProjectSprint) => {
    if (!window.confirm(t("tasks:planning.deleteSprintConfirm"))) return;
    try {
      await deleteSprintById(sprint.id);
      await invalidatePlanning();
      toast.success(t("tasks:planning.sprintDeleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.deleteError"),
      );
    }
  };

  const moveSprintToPhase = async (
    sprint: ProjectSprint,
    phaseId: string | null,
  ) => {
    try {
      const siblings = sprints.filter(
        (item) => (item.phaseId ?? null) === phaseId && item.id !== sprint.id,
      );
      await reorderSprints(project.id, [
        {
          id: sprint.id,
          position: siblings.length,
          phaseId,
        },
      ]);
      await invalidatePlanning();
      toast.success(t("tasks:planning.sprintMoved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.updateError"),
      );
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const active = parseSortableId(String(event.active.id));
    const over = event.over ? parseSortableId(String(event.over.id)) : null;
    if (!active || !over || active.id === over.id) return;

    try {
      if (active.type === "phase" && over.type === "phase") {
        const reordered = reorderById(sidebarPhases, active.id, over.id);
        if (!reordered) return;
        await reorderPhases(
          project.id,
          toPositionPayload(reordered, () => ({ parentId: null })),
        );
        await invalidatePlanning();
        return;
      }

      if (active.type === "sprint" && over.type === "sprint") {
        const activeSprint = sprints.find((sprint) => sprint.id === active.id);
        const overSprint = sprints.find((sprint) => sprint.id === over.id);
        if (!activeSprint || !overSprint) return;

        const targetPhaseId = overSprint.phaseId ?? null;
        if ((activeSprint.phaseId ?? null) !== targetPhaseId) {
          const siblings = sprints.filter(
            (sprint) => (sprint.phaseId ?? null) === targetPhaseId,
          );
          await reorderSprints(project.id, [
            {
              id: active.id,
              position: siblings.length,
              phaseId: targetPhaseId,
            },
          ]);
          await invalidatePlanning();
          return;
        }

        const siblings = sprints.filter(
          (sprint) => (sprint.phaseId ?? null) === targetPhaseId,
        );
        const reordered = reorderById(siblings, active.id, over.id);
        if (!reordered) return;
        await reorderSprints(
          project.id,
          toPositionPayload(reordered, () => ({ phaseId: targetPhaseId })),
        );
        await invalidatePlanning();
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.updateError"),
      );
    }
  };

  const hoverAction =
    "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent group-hover/row:opacity-100 data-[state=open]:opacity-100";

  const renderSprint = (sprint: ProjectSprint, phaseId: string) => (
    <SidebarMenuSubItem key={sprint.id}>
      <SortableRow id={sortableId("sprint", sprint.id)}>
        {({ listeners, attributes }) => (
          <div className="group/row flex min-w-0 items-center gap-0.5 pl-6">
            <button
              type="button"
              className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent active:cursor-grabbing group-hover/row:opacity-70"
              {...listeners}
              {...attributes}
              onClick={(event) => event.stopPropagation()}
            >
              <GripVertical className="size-3" />
            </button>
            <SidebarMenuSubButton
              size="sm"
              isActive={activeSprintId === sprint.id}
              onClick={() => openSprintWorkspace(sprint)}
              className="h-7 min-w-0 flex-1 gap-2 pr-0 font-normal"
            >
              <ListChecks className="size-3.5 shrink-0 text-muted-foreground" />
              <HierarchyInlineRename
                className="min-w-0 flex-1 text-sm"
                value={sprint.name}
                editing={renamingId === sprint.id}
                onEditingChange={(editing) =>
                  setRenamingId(editing ? sprint.id : null)
                }
                onCommit={(name) => renameSprint(sprint.id, name)}
              />
            </SidebarMenuSubButton>
            <PlanningDatesPopover
              startDate={sprint.startDate}
              endDate={sprint.endDate}
              title={t("tasks:planning.editSprintDates")}
              triggerClassName={hoverAction}
              onSave={async (dates) => {
                await patchSprint(sprint.id, dates);
                await invalidatePlanning();
                toast.success(t("tasks:planning.datesSaved"));
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button type="button" className={hoverAction} />}
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-44">
                <DropdownMenuItem onClick={() => setRenamingId(sprint.id)}>
                  <Pencil className="size-3.5" />
                  {t("tasks:planning.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void duplicateSprint(sprint)}>
                  <Copy className="size-3.5" />
                  {t("tasks:planning.duplicateSprint")}
                </DropdownMenuItem>
                {phasesEnabled && sidebarPhases.length > 0 ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Layers className="size-3.5" />
                      {t("tasks:planning.moveSprintToPhase")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {sidebarPhases.map((phase) => (
                        <DropdownMenuItem
                          key={phase.id}
                          disabled={phase.id === phaseId}
                          onClick={() =>
                            void moveSprintToPhase(sprint, phase.id)
                          }
                        >
                          {phase.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void deleteSprint(sprint)}
                >
                  <Trash2 className="size-3.5" />
                  {t("common:actions.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </SortableRow>
    </SidebarMenuSubItem>
  );

  const renderPhase = (phase: ProjectPhase) => {
    const expanded = expandedIds.has(phase.id);
    const phaseSprints = sprintsEnabled
      ? (sprintsByPhase.get(phase.id) ?? [])
      : [];
    const hasSprints = phaseSprints.length > 0;

    return (
      <SidebarMenuSubItem key={phase.id}>
        <SortableRow id={sortableId("phase", phase.id)}>
          {({ listeners, attributes }) => (
            <div className="group/row flex min-w-0 items-center gap-0.5">
              <button
                type="button"
                className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent active:cursor-grabbing group-hover/row:opacity-70"
                {...listeners}
                {...attributes}
                onClick={(event) => event.stopPropagation()}
              >
                <GripVertical className="size-3" />
              </button>
              {hasSprints || sprintsEnabled ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded(phase.id, !expanded);
                  }}
                  className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-accent"
                >
                  <ChevronRight
                    className={cn(
                      "size-3 transition-transform duration-200",
                      expanded && "rotate-90",
                    )}
                  />
                </button>
              ) : (
                <span className="size-5 shrink-0" />
              )}
              <SidebarMenuSubButton
                size="sm"
                isActive={activePhaseId === phase.id && !activeSprintId}
                onClick={() => openPhaseView(phase)}
                className="h-7 min-w-0 flex-1 gap-2 pr-0 font-normal"
              >
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <HierarchyInlineRename
                  className="min-w-0 flex-1 text-sm"
                  value={phase.name}
                  editing={renamingId === phase.id}
                  onEditingChange={(editing) =>
                    setRenamingId(editing ? phase.id : null)
                  }
                  onCommit={(name) => renamePhase(phase.id, name)}
                />
              </SidebarMenuSubButton>
              {sprintsEnabled ? (
                <PlanningQuickAddPopover project={project} phaseId={phase.id} />
              ) : null}
              <PlanningDatesPopover
                startDate={phase.startDate}
                endDate={phase.endDate}
                title={t("tasks:planning.editPhaseDates")}
                triggerClassName={hoverAction}
                onSave={async (dates) => {
                  await patchPhase(phase.id, dates);
                  await invalidatePlanning();
                  toast.success(t("tasks:planning.datesSaved"));
                }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<button type="button" className={hoverAction} />}
                >
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-44">
                  <DropdownMenuItem onClick={() => setRenamingId(phase.id)}>
                    <Pencil className="size-3.5" />
                    {t("tasks:planning.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openPlanningSettings}>
                    <Layers className="size-3.5" />
                    {t("tasks:planning.editPhaseDetails")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void duplicatePhase(phase)}>
                    <Copy className="size-3.5" />
                    {t("tasks:planning.duplicatePhase")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void archivePhase(phase)}>
                    {t("tasks:planning.archiveFolder")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void deletePhase(phase)}
                  >
                    <Trash2 className="size-3.5" />
                    {t("common:actions.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </SortableRow>
        {expanded && phaseSprints.length > 0 ? (
          <SidebarMenuSub className="mx-0 border-l border-border/60 px-0 py-0.5 ml-3">
            {phaseSprints.map((sprint) => renderSprint(sprint, phase.id))}
          </SidebarMenuSub>
        ) : null}
      </SidebarMenuSubItem>
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      <SortableContext
        items={sortableIds}
        strategy={verticalListSortingStrategy}
      >
        <SidebarMenuSub className="mx-0 max-h-[min(70vh,32rem)] overflow-y-auto border-l-0 px-0 py-0.5">
          {phasesEnabled && sidebarPhases.map((phase) => renderPhase(phase))}

          {sprintsEnabled &&
            !phasesEnabled &&
            (sprintsByPhase.get("") ?? []).map((sprint) => (
              <SidebarMenuSubItem key={sprint.id}>
                <SortableRow id={sortableId("sprint", sprint.id)}>
                  {({ listeners, attributes }) => (
                    <div className="group/row flex min-w-0 items-center gap-0.5">
                      <button
                        type="button"
                        className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-sidebar-accent active:cursor-grabbing group-hover/row:opacity-70"
                        {...listeners}
                        {...attributes}
                      >
                        <GripVertical className="size-3" />
                      </button>
                      <SidebarMenuSubButton
                        size="sm"
                        isActive={activeSprintId === sprint.id}
                        onClick={() => openSprintWorkspace(sprint)}
                        className="h-7 flex-1 gap-2 font-normal"
                      >
                        <ListChecks className="size-3.5 shrink-0" />
                        <TruncatedLabel text={sprint.name} />
                      </SidebarMenuSubButton>
                    </div>
                  )}
                </SortableRow>
              </SidebarMenuSubItem>
            ))}
        </SidebarMenuSub>
      </SortableContext>
    </DndContext>
  );
}
