import type { QueryClient } from "@tanstack/react-query";
import { createBoardMerger } from "@/fetchers/task/board-merger";
import {
  ARCHIVED_BUCKET,
  type BoardPageState,
  boardPageStateKey,
  bucketHasMore,
  bucketTasks,
  PLANNED_BUCKET,
} from "@/fetchers/task/board-page-state";
import { loadBoardBucket } from "@/fetchers/task/get-tasks";
import type { ProjectWithTasks } from "@/types/project";

const queues = new WeakMap<QueryClient, Map<string, Promise<boolean>>>();
const pendingMore = new Map<string, Promise<boolean>>();

export function getBoardPageState(queryClient: QueryClient, projectId: string) {
  return queryClient.getQueryData<BoardPageState>(boardPageStateKey(projectId));
}

/** True when every page of these statuses is in the cached board. */
export function boardBucketsLoaded(
  queryClient: QueryClient,
  projectId: string,
  statuses: string[],
) {
  const state = getBoardPageState(queryClient, projectId);
  return statuses.every((status) => {
    const bucket = state?.buckets[status];
    return bucket ? !bucketHasMore(bucket) : !state;
  });
}

// Loads run one at a time per project, so each starts from the pages the
// previous one recorded and no page is requested twice.
function enqueue(
  queryClient: QueryClient,
  projectId: string,
  run: () => Promise<boolean>,
) {
  const projects =
    queues.get(queryClient) ?? new Map<string, Promise<boolean>>();
  queues.set(queryClient, projects);
  const next = (projects.get(projectId) ?? Promise.resolve(true))
    .catch(() => false)
    .then(run);
  projects.set(projectId, next);
  return next;
}

/**
 * Appends pages of the given statuses to the cached board. Resolves false when
 * a full board refresh made the result stale; that refresh supersedes it.
 */
function loadBuckets(
  queryClient: QueryClient,
  projectId: string,
  requests: Array<{ status: string; pages: number }>,
) {
  return enqueue(queryClient, projectId, async () => {
    const boardKey = ["tasks", projectId];
    const state = getBoardPageState(queryClient, projectId);
    if (
      !state ||
      queryClient.getQueryState(boardKey)?.fetchStatus === "fetching"
    )
      return false;
    const pending = requests.flatMap(({ status, pages }) => {
      const bucket = state.buckets[status];
      if (bucket && !bucketHasMore(bucket)) return [];
      const fromPage = (bucket?.loadedPages ?? 0) + 1;
      return [{ status, fromPage, toPage: fromPage + pages - 1 }];
    });
    if (!pending.length) return true;
    const ranges = await Promise.all(
      pending.map((request) =>
        loadBoardBucket(projectId, request.status, request),
      ),
    );
    if (
      getBoardPageState(queryClient, projectId)?.generation !== state.generation
    )
      return false;
    const board = queryClient.setQueryData<ProjectWithTasks>(
      boardKey,
      (old) => {
        if (!old) return old;
        const next = structuredClone(old);
        const merger = createBoardMerger(next);
        for (const range of ranges) merger.merge(range.board);
        next.columns.sort(
          (left, right) => (left.position ?? 0) - (right.position ?? 0),
        );
        return next;
      },
    );
    if (!board) return false;
    queryClient.setQueryData<BoardPageState>(
      boardPageStateKey(projectId),
      (current) =>
        current && {
          ...current,
          buckets: {
            ...current.buckets,
            ...Object.fromEntries(
              pending.map(({ status }, index) => [
                status,
                {
                  loadedPages: ranges[index].loadedPages,
                  totalPages: ranges[index].totalPages,
                  total: ranges[index].total,
                  loadedCount: bucketTasks(board, status).length,
                },
              ]),
            ),
          },
        },
    );
    return true;
  });
}

/** Loads the next page of one column; repeated calls share the request. */
export function loadMoreBoardTasks(
  queryClient: QueryClient,
  projectId: string,
  status: string,
) {
  const key = `${projectId}:${status}`;
  const existing = pendingMore.get(key);
  if (existing) return existing;
  const request = loadBuckets(queryClient, projectId, [
    { status, pages: 1 },
  ]).finally(() => pendingMore.delete(key));
  pendingMore.set(key, request);
  return request;
}

/** Loads every remaining page of the given statuses. */
export function loadAllBoardBuckets(
  queryClient: QueryClient,
  projectId: string,
  statuses: string[],
) {
  return loadBuckets(
    queryClient,
    projectId,
    statuses.map((status) => ({ status, pages: Number.POSITIVE_INFINITY })),
  );
}

/**
 * Loads the complete columns holding these task or column ids. Reorders send
 * every task of the affected columns, so a drop needs them all. Returns true
 * synchronously when they are already complete, so the drop is not deferred;
 * otherwise resolves false when the columns could not be completed.
 */
export function loadCompleteColumns(
  queryClient: QueryClient,
  board: ProjectWithTasks,
  ids: string[],
): true | Promise<boolean> {
  const statuses = [
    ...new Set(
      ids.flatMap((id) => {
        const column = board.columns.find(
          (candidate) =>
            candidate.id === id ||
            candidate.tasks.some((task) => task.id === id),
        );
        return column ? [column.slug] : [];
      }),
    ),
  ];
  if (boardBucketsLoaded(queryClient, board.id, statuses)) return true;
  return loadAllBoardBuckets(queryClient, board.id, statuses).catch(
    () => false,
  );
}

/** Every status a complete board needs: its columns, planned and archived. */
export function allBoardStatuses(board: ProjectWithTasks) {
  return [
    ...board.columns.map((column) => column.slug),
    PLANNED_BUCKET,
    ARCHIVED_BUCKET,
  ];
}
