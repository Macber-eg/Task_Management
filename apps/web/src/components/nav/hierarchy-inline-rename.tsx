import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type HierarchyInlineRenameProps = {
  value: string;
  disabled?: boolean;
  className?: string;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onCommit: (next: string) => void | Promise<void>;
};

export default function HierarchyInlineRename({
  value,
  disabled,
  className,
  editing: controlledEditing,
  onEditingChange,
  onCommit,
}: HierarchyInlineRenameProps) {
  const [uncontrolledEditing, setUncontrolledEditing] = useState(false);
  const editing = controlledEditing ?? uncontrolledEditing;
  const setEditing = (next: boolean) => {
    onEditingChange?.(next);
    if (controlledEditing === undefined) setUncontrolledEditing(next);
  };
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === value) return;
    await onCommit(trimmed);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        disabled={disabled}
        className={cn("h-6 px-1 text-xs", className)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
          if (event.key === "Escape") {
            setEditing(false);
            setDraft(value);
          }
        }}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "block w-full truncate text-left",
        !disabled && "cursor-default hover:underline",
        className,
      )}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (!disabled) setEditing(true);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "F2") {
          event.stopPropagation();
          setEditing(true);
        }
      }}
    >
      {value}
    </span>
  );
}
