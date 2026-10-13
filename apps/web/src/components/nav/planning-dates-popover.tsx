import { CalendarRange } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateInputToIso, toDateInputValue } from "@/lib/planning-dates";

type PlanningDatesPopoverProps = {
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  title: string;
  onSave: (dates: {
    startDate: string | null;
    endDate: string | null;
  }) => void | Promise<void>;
  triggerClassName?: string;
};

export default function PlanningDatesPopover({
  startDate,
  endDate,
  title,
  onSave,
  triggerClassName,
}: PlanningDatesPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (!open) return;
    setStart(toDateInputValue(startDate));
    setEnd(toDateInputValue(endDate));
  }, [open, startDate, endDate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({
        startDate: dateInputToIso(start),
        endDate: dateInputToIso(end),
      });
      setOpen(false);
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
          className={triggerClassName}
        >
          <CalendarRange className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <p className="text-sm font-medium">{title}</p>
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("tasks:planning.startDate")}</Label>
              <Input
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tasks:planning.endDate")}</Label>
              <Input
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="h-8"
              />
            </div>
          </div>
          <Button type="submit" size="sm" className="w-full" disabled={busy}>
            {t("tasks:planning.saveDates")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
