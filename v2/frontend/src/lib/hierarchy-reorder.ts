import { arrayMove } from "@dnd-kit/sortable";

export function reorderById<T extends { id: string }>(
  items: T[],
  activeId: string,
  overId: string,
): T[] | null {
  const oldIndex = items.findIndex((item) => item.id === activeId);
  const newIndex = items.findIndex((item) => item.id === overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null;
  return arrayMove(items, oldIndex, newIndex);
}

export function toPositionPayload<T extends { id: string }>(
  items: T[],
  extra?: (item: T) => Record<string, unknown>,
) {
  return items.map((item, position) => ({
    id: item.id,
    position,
    ...(extra ? extra(item) : {}),
  }));
}

export function parseSortableId(raw: string) {
  const [type, id] = raw.split(":");
  if ((type === "phase" || type === "sprint") && id) {
    return { type, id } as const;
  }
  return null;
}

export function sortableId(type: "phase" | "sprint", id: string) {
  return `${type}:${id}`;
}
