import { useQueryClient } from "@tanstack/react-query";
import { produce } from "immer";
import { Archive, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import { columnTaskCount } from "@/fetchers/task/board-page-state";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useBoardPageState } from "@/hooks/queries/task/use-board-page-state";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { loadCompleteColumns } from "@/lib/board-pages";
import { getColumnIcon } from "@/lib/column";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { ArchiveTasksModal } from "../../shared/modals/archive-tasks-modal";

type ColumnHeaderProps = {
  column: ProjectWithTasks["columns"][number];
  disableCollectionActions?: boolean;
};

export function ColumnHeader({
  column,
  disableCollectionActions = false,
}: ColumnHeaderProps) {
  const { t } = useTranslation();
  const { project, setProject } = useProjectStore();
  const queryClient = useQueryClient();
  const taskCount = columnTaskCount(
    useBoardPageState(project?.id)?.buckets[column.slug],
    column.tasks.length,
  );
  const { mutate: updateTask } = useUpdateTask();
  const { canUpdateTasks, canCreateTasks } = useWorkspacePermission();
  const canTask = canUpdateTasks();
  const canCreate = canCreateTasks();

  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  const handleConfirmArchive = () => {
    if (disableCollectionActions || !column.isFinal || !project) return;

    // Archive the whole column, including pages not scrolled into view yet.
    const ready = loadCompleteColumns(queryClient, project, [column.id]);
    if (ready === true) return archiveColumnTasks(project);
    void ready.then((loaded) => {
      if (!loaded) toast.error(t("tasks:board.loadMoreTasksFailed"));
      else
        archiveColumnTasks(
          queryClient.getQueryData<ProjectWithTasks>(["tasks", project.id]) ??
            project,
        );
    });
  };

  const archiveColumnTasks = (board: ProjectWithTasks) => {
    const archivedCount =
      board.columns.find((col) => col.id === column.id)?.tasks.length ?? 0;

    const updatedProject = produce(board, (draft) => {
      const archivedColumn = draft?.columns?.find(
        (col) => col.id === column.id,
      );
      if (!archivedColumn) return;

      for (const task of archivedColumn.tasks) {
        updateTask({
          ...task,
          status: "archived",
        });
      }

      archivedColumn.tasks = [];
    });

    setProject(updatedProject);
    toast.success(t("tasks:archive.success", { count: archivedCount }));
    setIsArchiveModalOpen(false);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">
          {getColumnIcon(column.id, column.isFinal, column.icon)}
        </span>
        <span className="truncate text-sm font-medium text-foreground/95">
          {column.name}
        </span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {taskCount}
        </span>
      </div>

      <div className="flex items-center">
        {canTask && column.isFinal && taskCount > 0 && (
          <button
            type="button"
            disabled={disableCollectionActions}
            onClick={() => setIsArchiveModalOpen(true)}
            className="flex items-center rounded-md px-2 py-1 text-left text-muted-foreground transition-colors hover:bg-accent/50"
            title={t("tasks:listView.archiveAllTooltip")}
          >
            <Archive className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            onClick={() => setIsTaskModalOpen(true)}
            className="flex items-center rounded-md px-2 py-1 text-left text-muted-foreground transition-colors hover:bg-accent/50"
            title={t("tasks:kanban.addTask")}
          >
            <Plus className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      <CreateTaskModal
        open={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        projectId={project?.id}
        status={column.id}
      />

      <ArchiveTasksModal
        open={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        disabled={disableCollectionActions}
        onConfirm={handleConfirmArchive}
        taskCount={taskCount}
      />
    </div>
  );
}
