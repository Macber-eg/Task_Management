import type { ProjectWithTasks } from "@/types/project";

/** Tasks requested per column page while scrolling a board. */
export const BOARD_BUCKET_PAGE_SIZE = 50;

export const PLANNED_BUCKET = "planned";
export const ARCHIVED_BUCKET = "archived";

/** Server paging for one task status: a board column, planned or archived. */
export type BucketPages = {
  loadedPages: number;
  totalPages: number;
  total: number;
  /** Cached tasks with this status right after the last page load. */
  loadedCount: number;
};

export type BoardPageState = {
  /** Bumped by every full board refresh so stale page loads are dropped. */
  generation: number;
  buckets: Record<string, BucketPages>;
};

export const boardPageStateKey = (projectId: string) => [
  "tasks-pages",
  projectId,
];

export function bucketTasks(board: ProjectWithTasks, status: string) {
  if (status === PLANNED_BUCKET) return board.plannedTasks;
  if (status === ARCHIVED_BUCKET) return board.archivedTasks;
  return board.columns.find((column) => column.slug === status)?.tasks ?? [];
}

export function bucketHasMore(bucket: BucketPages | undefined) {
  return !!bucket && bucket.loadedPages < bucket.totalPages;
}

/**
 * The column's real size while later pages are unloaded: the server total,
 * adjusted by tasks that live updates added or removed since the last load.
 */
export function columnTaskCount(
  bucket: BucketPages | undefined,
  loadedTasks: number,
) {
  if (!bucketHasMore(bucket) || !bucket) return loadedTasks;
  return Math.max(loadedTasks, bucket.total - bucket.loadedCount + loadedTasks);
}
