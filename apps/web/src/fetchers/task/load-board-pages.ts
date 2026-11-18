import type { ProjectWithTasks } from "@/types/project";
import { createBoardMerger } from "./board-merger";

export type BoardPage<T extends ProjectWithTasks> = {
  data: T;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    total: number;
    relatedTotalPages?: number;
  };
};

export type BoardPageRange<T extends ProjectWithTasks> = {
  board: T;
  /** Last task page included in `board`. */
  loadedPages: number;
  totalPages: number;
  total: number;
};

type RangeOptions<T extends ProjectWithTasks> = {
  fromPage?: number;
  toPage?: number;
  signal?: AbortSignal;
  onProgress?: (board: T) => void;
};

/** Loads task pages `fromPage..toPage`, with every related page of each. */
export async function loadBoardPageRange<T extends ProjectWithTasks>(
  load: (page: number, relatedPage?: number) => Promise<BoardPage<T>>,
  {
    fromPage = 1,
    toPage = Number.POSITIVE_INFINITY,
    signal,
    onProgress,
  }: RangeOptions<T> = {},
): Promise<BoardPageRange<T>> {
  signal?.throwIfAborted();
  const first = await load(fromPage);
  const result = first.data;
  const merger = createBoardMerger(result);
  let nextProgressWeight = 0;
  const reportProgress = (force = false) => {
    signal?.throwIfAborted();
    if (!onProgress || (!force && merger.weight < nextProgressWeight)) return;
    result.columns.sort(
      (left, right) => (left.position ?? 0) - (right.position ?? 0),
    );
    onProgress(structuredClone(result));
    nextProgressWeight = Math.max(1, merger.weight * 2);
  };
  reportProgress(true);
  const loadRelated = async (page: number, initial: BoardPage<T>) => {
    // Each collection uses its initial count; live additions cannot indefinitely
    // extend a refresh. The next refresh sees changes made during pagination.
    const total = initial.pagination.relatedTotalPages ?? 1;
    for (let relatedPage = 2; relatedPage <= total; relatedPage++) {
      signal?.throwIfAborted();
      merger.merge((await load(page, relatedPage)).data);
      reportProgress();
    }
  };
  await loadRelated(fromPage, first);
  const lastPage = Math.min(toPage, first.pagination.totalPages);
  for (let page = fromPage + 1; page <= lastPage; page++) {
    signal?.throwIfAborted();
    const next = await load(page);
    merger.merge(next.data);
    reportProgress();
    await loadRelated(page, next);
  }
  result.columns.sort(
    (left, right) => (left.position ?? 0) - (right.position ?? 0),
  );
  signal?.throwIfAborted();
  reportProgress(true);
  return {
    board: result,
    loadedPages: Math.max(fromPage, lastPage),
    totalPages: first.pagination.totalPages,
    total: first.pagination.total,
  };
}

/** Publish immutable snapshots as bounded pages arrive. */
export async function loadBoardPages<T extends ProjectWithTasks>(
  load: (page: number, relatedPage?: number) => Promise<BoardPage<T>>,
  signal?: AbortSignal,
  onProgress?: (board: T) => void,
): Promise<T> {
  return (await loadBoardPageRange(load, { signal, onProgress })).board;
}
