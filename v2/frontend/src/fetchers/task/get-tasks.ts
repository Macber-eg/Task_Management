import { client } from "@/lib/api";
import type { InferResponseType } from "@/lib/api";
import getColumns from "@/fetchers/column/get-columns";
import { HttpError } from "@/lib/http-error";
import type { ProjectWithTasks } from "@/types/project";
import { createBoardMerger } from "./board-merger";
import {
  BOARD_BUCKET_PAGE_SIZE,
  type BoardPageState,
  bucketTasks,
  PLANNED_BUCKET,
} from "./board-page-state";
import { loadBoardPageRange } from "./load-board-pages";

type TasksResponse = InferResponseType<
  (typeof client)["task"]["tasks"][":projectId"]["$get"],
  200
>;
type Board = TasksResponse["data"];

async function fetchTasksPage(
  projectId: string,
  query: { page: number; status: string; relatedPage?: number },
  signal?: AbortSignal,
) {
  const response = await client.task.tasks[":projectId"].$get(
    {
      param: { projectId },
      query: {
        page: String(query.page),
        limit: String(BOARD_BUCKET_PAGE_SIZE),
        status: query.status,
        ...(query.relatedPage
          ? { relatedPage: String(query.relatedPage) }
          : {}),
      },
    },
    { init: { signal } },
  );
  if (!response.ok)
    throw new HttpError(response.status, "Failed to fetch tasks");
  return response.json();
}

/** Loads task pages `fromPage..toPage` of a single status. */
export function loadBoardBucket(
  projectId: string,
  status: string,
  range: { fromPage?: number; toPage?: number },
  signal?: AbortSignal,
) {
  return loadBoardPageRange(
    (page, relatedPage) =>
      fetchTasksPage(projectId, { page, status, relatedPage }, signal),
    { ...range, signal },
  );
}

type GetTasksOptions = {
  /** Pages loaded per status before this refresh; defaults to one page each. */
  pageState?: BoardPageState;
  onPageState?: (state: BoardPageState["buckets"]) => void;
};

/**
 * Loads a board column by column, refreshing as many pages of each column as
 * were loaded before. Later pages load on demand as the user scrolls.
 */
async function getTasks(
  projectId: string,
  signal?: AbortSignal,
  _onProgress?: (board: Board) => void,
  { pageState, onPageState }: GetTasksOptions = {},
) {
  const columns = await getColumns(projectId);
  signal?.throwIfAborted();
  const statuses = [
    ...new Set([
      ...columns.map((column) => column.slug),
      ...Object.keys(pageState?.buckets ?? {}),
    ]),
  ];
  // A board without columns still needs one request for its project fields.
  if (!statuses.length) statuses.push(PLANNED_BUCKET);
  const ranges = await Promise.all(
    statuses.map((status) =>
      loadBoardBucket(
        projectId,
        status,
        { toPage: pageState?.buckets[status]?.loadedPages ?? 1 },
        signal,
      ),
    ),
  );
  const [first, ...rest] = ranges;
  const board = first.board;
  const merger = createBoardMerger(board);
  for (const range of rest) merger.merge(range.board);
  board.columns.sort(
    (left, right) => (left.position ?? 0) - (right.position ?? 0),
  );
  onPageState?.(
    Object.fromEntries(
      statuses.map((status, index) => [
        status,
        {
          loadedPages: ranges[index].loadedPages,
          totalPages: ranges[index].totalPages,
          total: ranges[index].total,
          loadedCount: bucketTasks(board as ProjectWithTasks, status).length,
        },
      ]),
    ),
  );
  return board;
}
export default getTasks;
