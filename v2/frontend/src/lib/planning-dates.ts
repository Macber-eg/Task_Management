export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function dateInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function formatPlanningRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const startVal = toDateInputValue(start ?? null);
  const endVal = toDateInputValue(end ?? null);
  if (!startVal && !endVal) return null;
  if (startVal && endVal) return `${startVal} → ${endVal}`;
  if (startVal) return startVal;
  return endVal;
}
