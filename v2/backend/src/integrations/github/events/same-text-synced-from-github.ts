/**
 * Loop prevention: the task already holds `value` because GitHub sent it
 * (`lastSync[field]` stamped with source "github").
 */
export function sameTextSyncedFromGitHub(
  metadata: string | null,
  field: "title" | "description",
  value: string,
): boolean {
  const parsed = metadata
    ? (JSON.parse(metadata) as {
        lastSync?: Record<string, { value?: unknown; source?: unknown }>;
      })
    : {};
  const stamp = parsed.lastSync?.[field];
  return stamp?.value === value && stamp.source === "github";
}
