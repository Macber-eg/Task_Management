import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import { dateInputToIso, toDateInputValue } from "@/lib/planning-dates";
import { toast } from "@/lib/toast";
import type { ProjectWithTasks } from "@/types/project";

type ProjectDateSettingsProps = {
  project: ProjectWithTasks;
  canEdit: boolean;
  workspaceId: string;
};

export default function ProjectDateSettings({
  project,
  canEdit,
  workspaceId,
}: ProjectDateSettingsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mutateAsync: updateProject, isPending } = useUpdateProject();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    setStartDate(toDateInputValue(project.startDate ?? null));
    setEndDate(toDateInputValue(project.endDate ?? null));
  }, [project.startDate, project.endDate]);

  const persist = async (nextStart: string, nextEnd: string) => {
    if (!canEdit) return;
    try {
      await updateProject({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description ?? "",
        icon: project.icon ?? "Layout",
        isPublic: !!project.isPublic,
        phasesEnabled: !!project.phasesEnabled,
        sprintsEnabled: !!project.sprintsEnabled,
        startDate: dateInputToIso(nextStart),
        endDate: dateInputToIso(nextEnd),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["tasks", project.id] }),
      ]);
      toast.success(t("settings:projectGeneral.toastUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectGeneral.toastUpdateError"),
      );
    }
  };

  return (
    <div className="grid max-w-md grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor="project-settings-start" className="text-xs">
          {t("tasks:planning.startDate")}
        </Label>
        <Input
          id="project-settings-start"
          type="date"
          disabled={!canEdit || isPending}
          value={startDate}
          onChange={(event) => {
            const value = event.target.value;
            setStartDate(value);
            void persist(value, endDate);
          }}
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="project-settings-end" className="text-xs">
          {t("tasks:planning.endDate")}
        </Label>
        <Input
          id="project-settings-end"
          type="date"
          disabled={!canEdit || isPending}
          value={endDate}
          onChange={(event) => {
            const value = event.target.value;
            setEndDate(value);
            void persist(startDate, value);
          }}
          className="h-8"
        />
      </div>
    </div>
  );
}
