import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import useCreateTimeEntry from "@/hooks/mutations/time-entry/use-create-time-entry";
import useUpdateTimeEntry from "@/hooks/mutations/time-entry/use-update-time-entry";
import useGetActiveTimeEntry from "@/hooks/queries/time-entry/use-get-active-time-entry";
import type { ActiveTimeEntryDetails } from "@/fetchers/time-entry/get-active-time-entry";
import { elapsedSecondsSince } from "@/lib/format-duration";
import { toast } from "@/lib/toast";
import TaskStickyTimer from "./task-sticky-timer";

type TaskTimerContextValue = {
  running: ActiveTimeEntryDetails | null;
  elapsed: number;
  isRunningTask: (taskId: string) => boolean;
  startTimer: (taskId: string) => Promise<void>;
  stopTimer: () => Promise<void>;
  isPending: boolean;
};

const TaskTimerContext = createContext<TaskTimerContextValue | null>(null);

export function TaskTimerProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { data, refetch } = useGetActiveTimeEntry();
  const running = data?.running ?? null;
  const createEntry = useCreateTimeEntry();
  const updateEntry = useUpdateTimeEntry(running?.taskId ?? "");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running?.startTime) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(elapsedSecondsSince(running.startTime));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [running?.startTime, running?.id]);

  const startTimer = useCallback(
    async (taskId: string) => {
      try {
        await createEntry.mutateAsync({
          taskId,
          startTime: new Date().toISOString(),
        });
        await refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to start timer",
        );
        throw error;
      }
    },
    [createEntry, refetch],
  );

  const stopTimer = useCallback(async () => {
    if (!running) return;
    const endTime = new Date().toISOString();
    try {
      await updateEntry.mutateAsync({
        id: running.id,
        startTime: running.startTime,
        endTime,
        description: running.description ?? undefined,
      });
      await refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to stop timer",
      );
      throw error;
    }
  }, [running, updateEntry, refetch]);

  const openRunningTask = useCallback(() => {
    if (!running) return;
    void navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: {
        workspaceId: running.workspaceId,
        projectId: running.projectId,
      },
      search: { taskId: running.taskId },
    });
  }, [navigate, running]);

  const value = useMemo(
    () => ({
      running,
      elapsed,
      isRunningTask: (taskId: string) => !!running && running.taskId === taskId,
      startTimer,
      stopTimer,
      isPending: createEntry.isPending || updateEntry.isPending,
    }),
    [
      running,
      elapsed,
      startTimer,
      stopTimer,
      createEntry.isPending,
      updateEntry.isPending,
    ],
  );

  return (
    <TaskTimerContext.Provider value={value}>
      <div className={running ? "pb-20" : undefined}>{children}</div>
      {running && (
        <TaskStickyTimer
          running={running}
          elapsed={elapsed}
          onOpen={openRunningTask}
          onStop={() => void stopTimer()}
          disabled={value.isPending}
        />
      )}
    </TaskTimerContext.Provider>
  );
}

export function useTaskTimer() {
  const ctx = useContext(TaskTimerContext);
  if (!ctx) {
    throw new Error("useTaskTimer must be used within TaskTimerProvider");
  }
  return ctx;
}
