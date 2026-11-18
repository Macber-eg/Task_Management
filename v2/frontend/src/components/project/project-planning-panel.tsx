import { useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import createPhase from "@/fetchers/planning/create-phase";
import createSprint from "@/fetchers/planning/create-sprint";
import deletePhase from "@/fetchers/planning/delete-phase";
import deleteSprint from "@/fetchers/planning/delete-sprint";
import type {
  ProjectPhase,
  ProjectSprint,
} from "@/fetchers/planning/planning-api";
import {
  dateInputToIso,
  formatPlanningRange,
  toDateInputValue,
} from "@/lib/planning-dates";
import { patchPhase, patchSprint } from "@/fetchers/planning/planning-api";
import { useGetPhases } from "@/hooks/queries/planning/use-get-phases";
import { useGetSprints } from "@/hooks/queries/planning/use-get-sprints";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { toast } from "@/lib/toast";

type ProjectPlanningPanelProps = {
  projectId: string;
  workspaceId: string;
};

type NewPhaseForm = {
  name: string;
  startDate: string;
  endDate: string;
};

type NewSprintForm = {
  name: string;
  startDate: string;
  endDate: string;
};

const emptyPhaseForm = (): NewPhaseForm => ({
  name: "",
  startDate: "",
  endDate: "",
});

const emptySprintForm = (): NewSprintForm => ({
  name: "",
  startDate: "",
  endDate: "",
});

function DateFields({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  disabled,
  idPrefix,
}: {
  startDate: string;
  endDate: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-start`} className="text-xs">
          {t("tasks:planning.startDate")}
        </Label>
        <Input
          id={`${idPrefix}-start`}
          type="date"
          value={startDate}
          disabled={disabled}
          onChange={(e) => onStartChange(e.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-end`} className="text-xs">
          {t("tasks:planning.endDate")}
        </Label>
        <Input
          id={`${idPrefix}-end`}
          type="date"
          value={endDate}
          disabled={disabled}
          onChange={(e) => onEndChange(e.target.value)}
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}

export default function ProjectPlanningPanel({
  projectId,
  workspaceId,
}: ProjectPlanningPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const phasesEnabled = !!project?.phasesEnabled;
  const sprintsEnabled = !!project?.sprintsEnabled;
  const { data: phases = [] } = useGetPhases(projectId, phasesEnabled);
  const { data: sprints = [] } = useGetSprints(projectId, sprintsEnabled);
  const [newPhase, setNewPhase] = useState<NewPhaseForm>(emptyPhaseForm);
  const [newSprintByPhase, setNewSprintByPhase] = useState<
    Record<string, NewSprintForm>
  >({});
  const [standaloneSprint, setStandaloneSprint] =
    useState<NewSprintForm>(emptySprintForm);
  const [busy, setBusy] = useState(false);

  const sprintsByPhase = useMemo(() => {
    const map = new Map<string, ProjectSprint[]>();
    for (const sprint of sprints) {
      const key = sprint.phaseId ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(sprint);
    }
    return map;
  }, [sprints]);

  const orphanSprints = sprintsByPhase.get("") ?? [];

  if (!phasesEnabled && !sprintsEnabled) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-16 text-center">
        <Layers className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t("tasks:planning.disabledHint")}
        </p>
        <Link
          to="/dashboard/settings/projects/$projectId/general"
          params={{ projectId }}
          className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          {t("tasks:planning.openSettings")}
        </Link>
      </div>
    );
  }

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["phases", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["sprints", projectId] }),
    ]);
  };

  const getSprintForm = (phaseId: string) =>
    newSprintByPhase[phaseId] ?? emptySprintForm();

  const setSprintForm = (phaseId: string, patch: Partial<NewSprintForm>) => {
    setNewSprintByPhase((prev) => ({
      ...prev,
      [phaseId]: { ...getSprintForm(phaseId), ...patch },
    }));
  };

  const handleAddPhase = async () => {
    const name = newPhase.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createPhase(projectId, {
        name,
        startDate: dateInputToIso(newPhase.startDate),
        endDate: dateInputToIso(newPhase.endDate),
      });
      setNewPhase(emptyPhaseForm());
      await invalidate();
      toast.success(t("tasks:planning.phaseCreated"));
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

  const handleAddSprint = async (phaseId: string | null) => {
    const form = phaseId ? getSprintForm(phaseId) : standaloneSprint;
    const name = form.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createSprint(projectId, {
        name,
        phaseId,
        startDate: dateInputToIso(form.startDate),
        endDate: dateInputToIso(form.endDate),
      });
      if (phaseId) {
        setSprintForm(phaseId, emptySprintForm());
      } else {
        setStandaloneSprint(emptySprintForm());
      }
      await invalidate();
      toast.success(t("tasks:planning.sprintCreated"));
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

  const savePhaseDates = async (
    phase: ProjectPhase,
    start: string,
    end: string,
  ) => {
    setBusy(true);
    try {
      await patchPhase(phase.id, {
        startDate: dateInputToIso(start),
        endDate: dateInputToIso(end),
      });
      await invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.updateError"),
      );
    } finally {
      setBusy(false);
    }
  };

  const saveSprintDates = async (
    sprint: ProjectSprint,
    start: string,
    end: string,
  ) => {
    setBusy(true);
    try {
      await patchSprint(sprint.id, {
        startDate: dateInputToIso(start),
        endDate: dateInputToIso(end),
      });
      await invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:planning.updateError"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      {phasesEnabled && (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">
              {t("tasks:planning.phasesTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("tasks:planning.phasesSubtitleNested")}
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <Input
              value={newPhase.name}
              onChange={(e) =>
                setNewPhase((p) => ({ ...p, name: e.target.value }))
              }
              placeholder={t("tasks:planning.phaseNamePlaceholder")}
              disabled={busy}
            />
            <DateFields
              idPrefix="new-phase"
              startDate={newPhase.startDate}
              endDate={newPhase.endDate}
              disabled={busy}
              onStartChange={(v) =>
                setNewPhase((p) => ({ ...p, startDate: v }))
              }
              onEndChange={(v) => setNewPhase((p) => ({ ...p, endDate: v }))}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !newPhase.name.trim()}
              onClick={() => void handleAddPhase()}
            >
              <Plus className="size-3.5" />
              {t("tasks:planning.addPhase")}
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            {phases.map((phase: ProjectPhase) => {
              const phaseSprints = sprintsByPhase.get(phase.id) ?? [];
              const sprintForm = getSprintForm(phase.id);
              return (
                <div
                  key={phase.id}
                  className="rounded-lg border border-border bg-card/40"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-sm font-semibold">{phase.name}</p>
                      <DateFields
                        idPrefix={`phase-${phase.id}`}
                        startDate={toDateInputValue(phase.startDate)}
                        endDate={toDateInputValue(phase.endDate)}
                        disabled={busy}
                        onStartChange={(start) =>
                          void savePhaseDates(
                            phase,
                            start,
                            toDateInputValue(phase.endDate),
                          )
                        }
                        onEndChange={(end) =>
                          void savePhaseDates(
                            phase,
                            toDateInputValue(phase.startDate),
                            end,
                          )
                        }
                      />
                      {formatPlanningRange(phase.startDate, phase.endDate) && (
                        <p className="text-[10px] text-muted-foreground">
                          {formatPlanningRange(phase.startDate, phase.endDate)}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0"
                      aria-label={t("common:actions.delete")}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await deletePhase(phase.id);
                          await invalidate();
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : t("tasks:planning.deleteError"),
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  {sprintsEnabled && (
                    <div className="space-y-2 px-3 py-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("tasks:planning.sprintsUnderPhase")}
                      </p>
                      <ul className="space-y-2">
                        {phaseSprints.map((sprint) => (
                          <li
                            key={sprint.id}
                            className="rounded-md border border-border/80 bg-background px-2 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm">{sprint.name}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 shrink-0"
                                disabled={busy}
                                onClick={async () => {
                                  setBusy(true);
                                  try {
                                    await deleteSprint(sprint.id);
                                    await invalidate();
                                  } catch (error) {
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : t("tasks:planning.deleteError"),
                                    );
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                            <DateFields
                              idPrefix={`sprint-${sprint.id}`}
                              startDate={toDateInputValue(sprint.startDate)}
                              endDate={toDateInputValue(sprint.endDate)}
                              disabled={busy}
                              onStartChange={(start) =>
                                void saveSprintDates(
                                  sprint,
                                  start,
                                  toDateInputValue(sprint.endDate),
                                )
                              }
                              onEndChange={(end) =>
                                void saveSprintDates(
                                  sprint,
                                  toDateInputValue(sprint.startDate),
                                  end,
                                )
                              }
                            />
                          </li>
                        ))}
                      </ul>
                      <div className="space-y-2 rounded-md border border-dashed border-border p-2">
                        <Input
                          value={sprintForm.name}
                          onChange={(e) =>
                            setSprintForm(phase.id, { name: e.target.value })
                          }
                          placeholder={t(
                            "tasks:planning.sprintNamePlaceholder",
                          )}
                          disabled={busy}
                          className="h-8 text-sm"
                        />
                        <DateFields
                          idPrefix={`new-sprint-${phase.id}`}
                          startDate={sprintForm.startDate}
                          endDate={sprintForm.endDate}
                          disabled={busy}
                          onStartChange={(v) =>
                            setSprintForm(phase.id, { startDate: v })
                          }
                          onEndChange={(v) =>
                            setSprintForm(phase.id, { endDate: v })
                          }
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy || !sprintForm.name.trim()}
                          onClick={() => void handleAddSprint(phase.id)}
                        >
                          <Plus className="size-3.5" />
                          {t("tasks:planning.addSprint")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {phases.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">
                {t("tasks:planning.noPhases")}
              </p>
            )}
          </div>
        </section>
      )}

      {sprintsEnabled && !phasesEnabled && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">
              {t("tasks:planning.sprintsTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("tasks:planning.sprintsSubtitle")}
            </p>
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Input
              value={standaloneSprint.name}
              onChange={(e) =>
                setStandaloneSprint((s) => ({ ...s, name: e.target.value }))
              }
              placeholder={t("tasks:planning.sprintNamePlaceholder")}
              disabled={busy}
            />
            <DateFields
              idPrefix="standalone-sprint"
              startDate={standaloneSprint.startDate}
              endDate={standaloneSprint.endDate}
              disabled={busy}
              onStartChange={(v) =>
                setStandaloneSprint((s) => ({ ...s, startDate: v }))
              }
              onEndChange={(v) =>
                setStandaloneSprint((s) => ({ ...s, endDate: v }))
              }
            />
            <Button
              type="button"
              disabled={busy || !standaloneSprint.name.trim()}
              onClick={() => void handleAddSprint(null)}
            >
              {t("tasks:planning.add")}
            </Button>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {orphanSprints.map((sprint: ProjectSprint) => (
              <li key={sprint.id} className="space-y-2 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>{sprint.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await deleteSprint(sprint.id);
                        await invalidate();
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : t("tasks:planning.deleteError"),
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <DateFields
                  idPrefix={`orphan-${sprint.id}`}
                  startDate={toDateInputValue(sprint.startDate)}
                  endDate={toDateInputValue(sprint.endDate)}
                  disabled={busy}
                  onStartChange={(start) =>
                    void saveSprintDates(
                      sprint,
                      start,
                      toDateInputValue(sprint.endDate),
                    )
                  }
                  onEndChange={(end) =>
                    void saveSprintDates(
                      sprint,
                      toDateInputValue(sprint.startDate),
                      end,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
