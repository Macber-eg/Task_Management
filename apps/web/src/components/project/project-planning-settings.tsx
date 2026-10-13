import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import type { ProjectWithTasks } from "@/types/project";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";

type ProjectPlanningSettingsProps = {
  project: ProjectWithTasks;
  canEdit: boolean;
  workspaceId: string;
};

export default function ProjectPlanningSettings({
  project,
  canEdit,
  workspaceId,
}: ProjectPlanningSettingsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mutateAsync: updateProject, isPending } = useUpdateProject();
  const { project: storeProject, setProject } = useProjectStore();

  const saveFlags = useCallback(
    async (phasesEnabled: boolean, sprintsEnabled: boolean) => {
      try {
        const updated = await updateProject({
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description ?? "",
          icon: project.icon ?? "Layout",
          isPublic: !!project.isPublic,
          phasesEnabled,
          sprintsEnabled,
          startDate: project.startDate ?? null,
          endDate: project.endDate ?? null,
        });
        if (storeProject?.id === project.id) {
          setProject({
            ...storeProject,
            phasesEnabled: updated.phasesEnabled ?? phasesEnabled,
            sprintsEnabled: updated.sprintsEnabled ?? sprintsEnabled,
          });
        }
        queryClient.setQueryData(
          ["tasks", project.id],
          (current: ProjectWithTasks | undefined) =>
            current
              ? {
                  ...current,
                  phasesEnabled: updated.phasesEnabled ?? phasesEnabled,
                  sprintsEnabled: updated.sprintsEnabled ?? sprintsEnabled,
                }
              : current,
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
          queryClient.invalidateQueries({
            queryKey: ["projects", workspaceId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["projects", workspaceId, project.id],
          }),
          queryClient.invalidateQueries({ queryKey: ["tasks", project.id] }),
        ]);
        toast.success(t("settings:projectGeneral.planning.toastUpdated"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:projectGeneral.planning.toastUpdateError"),
        );
      }
    },
    [
      project,
      queryClient,
      setProject,
      storeProject,
      t,
      updateProject,
      workspaceId,
    ],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {t("settings:projectGeneral.planning.phasesLabel")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("settings:projectGeneral.planning.phasesHint")}
          </p>
        </div>
        <Switch
          checked={!!project.phasesEnabled}
          disabled={!canEdit || isPending}
          onCheckedChange={(checked) =>
            saveFlags(checked, !!project.sprintsEnabled)
          }
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {t("settings:projectGeneral.planning.sprintsLabel")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("settings:projectGeneral.planning.sprintsHint")}
          </p>
        </div>
        <Switch
          checked={!!project.sprintsEnabled}
          disabled={!canEdit || isPending}
          onCheckedChange={(checked) =>
            saveFlags(!!project.phasesEnabled, checked)
          }
        />
      </div>
    </div>
  );
}
