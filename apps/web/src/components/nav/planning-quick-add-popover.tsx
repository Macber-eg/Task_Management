import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import createPhase from "@/fetchers/planning/create-phase";
import createSprint from "@/fetchers/planning/create-sprint";
import { dateInputToIso } from "@/lib/planning-dates";
import { toast } from "@/lib/toast";
type PlanningQuickAddProject = {
  id: string;
  phasesEnabled?: boolean;
  sprintsEnabled?: boolean;
};

type PlanningQuickAddPopoverProps = {
  project: PlanningQuickAddProject;
  /** When set, creates a sprint under this phase. Otherwise creates a root phase. */
  phaseId?: string | null;
  className?: string;
};

type FormState = {
  name: string;
  startDate: string;
  endDate: string;
};

const emptyForm = (): FormState => ({
  name: "",
  startDate: "",
  endDate: "",
});

export default function PlanningQuickAddPopover({
  project,
  phaseId = null,
  className,
}: PlanningQuickAddPopoverProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const phasesEnabled = !!project.phasesEnabled;
  const sprintsEnabled = !!project.sprintsEnabled;
  const addingSprint = phaseId != null;

  const title = addingSprint
    ? t("tasks:planning.addSprint")
    : t("tasks:planning.addPhase");

  if (addingSprint && !sprintsEnabled) return null;
  if (!addingSprint && !phasesEnabled) return null;

  const reset = () => {
    setForm(emptyForm());
    setOpen(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      if (addingSprint) {
        await createSprint(project.id, {
          name,
          phaseId: phasesEnabled ? phaseId : null,
          startDate: dateInputToIso(form.startDate),
          endDate: dateInputToIso(form.endDate),
        });
        toast.success(t("tasks:planning.sprintCreated"));
      } else {
        await createPhase(project.id, {
          name,
          parentId: null,
          kind: "folder",
          startDate: dateInputToIso(form.startDate),
          endDate: dateInputToIso(form.endDate),
        });
        toast.success(t("tasks:planning.phaseCreated"));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["phases", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["sprints", project.id] }),
      ]);
      reset();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.createError"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className={
            className ??
            "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent group-hover/row:opacity-100"
          }
        >
          <Plus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <p className="text-sm font-medium">{title}</p>
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="space-y-1">
            <Label
              htmlFor={`quick-add-name-${project.id}-${phaseId ?? "root"}`}
              className="text-xs"
            >
              {addingSprint
                ? t("tasks:planning.sprintNamePlaceholder")
                : t("tasks:planning.phaseNamePlaceholder")}
            </Label>
            <Input
              id={`quick-add-name-${project.id}-${phaseId ?? "root"}`}
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="h-8"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("tasks:planning.startDate")}</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    startDate: event.target.value,
                  }))
                }
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tasks:planning.endDate")}</Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, endDate: event.target.value }))
                }
                className="h-8"
              />
            </div>
          </div>
          <Button type="submit" size="sm" className="w-full" disabled={busy}>
            {title}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
