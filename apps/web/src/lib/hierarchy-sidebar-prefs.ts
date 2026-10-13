const STORAGE_PREFIX = "kaneo:hierarchy-expanded:";

function storageKey(projectId: string) {
  return `${STORAGE_PREFIX}${projectId}`;
}

export function readExpandedIds(projectId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function writeExpandedIds(projectId: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(projectId), JSON.stringify([...ids]));
}

export function toggleExpandedId(
  projectId: string,
  id: string,
  expanded: boolean,
): Set<string> {
  const next = readExpandedIds(projectId);
  if (expanded) next.add(id);
  else next.delete(id);
  writeExpandedIds(projectId, next);
  return next;
}
