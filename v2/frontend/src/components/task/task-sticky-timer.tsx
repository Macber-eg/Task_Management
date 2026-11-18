import { Clock3, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ActiveTimeEntryDetails } from "@/fetchers/time-entry/get-active-time-entry";
import {
  formatClockDuration,
  formatMinutesSeconds,
} from "@/lib/format-duration";

type TaskStickyTimerProps = {
  running: ActiveTimeEntryDetails;
  elapsed: number;
  onOpen: () => void;
  onStop: () => void;
  disabled?: boolean;
};

export default function TaskStickyTimer({
  running,
  elapsed,
  onOpen,
  onStop,
  disabled,
}: TaskStickyTimerProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] flex items-stretch border-t border-border bg-zinc-900 text-zinc-50 shadow-[0_-8px_32px_rgba(0,0,0,0.25)] md:left-[var(--sidebar-width,16rem)]"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800"
        onClick={onOpen}
      >
        <Clock3 className="size-5 shrink-0 text-emerald-400 animate-pulse" />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm">
            {running.taskTitle}
          </strong>
          <small className="text-xs text-zinc-400">
            {running.projectSlug}-{running.taskNumber}
          </small>
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block text-xl font-bold text-emerald-300">
            {formatClockDuration(elapsed)}
          </span>
          <span className="block text-xs text-zinc-400">
            {formatMinutesSeconds(elapsed)}
          </span>
        </span>
      </button>
      <Button
        type="button"
        variant="default"
        className="h-auto rounded-none border-l border-zinc-700 bg-violet-600 px-5 hover:bg-violet-500"
        disabled={disabled}
        onClick={onStop}
      >
        <Square className="mr-2 size-3.5 fill-current" />
        {t("tasks:properties.stopTimer")}
      </Button>
    </div>
  );
}
