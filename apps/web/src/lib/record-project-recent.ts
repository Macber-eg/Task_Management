import { recordProjectRecent } from "@/fetchers/project-home/project-home-api";

export function recordProjectRecentItem(
  projectId: string,
  item: {
    itemType: "phase" | "sprint" | "task" | "document";
    itemId: string;
    title: string;
    parentLabel?: string | null;
  },
) {
  void recordProjectRecent(projectId, item).catch(() => {
    // Best-effort; do not block navigation.
  });
}
