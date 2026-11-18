import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import {
  type BoardPageState,
  boardPageStateKey,
} from "@/fetchers/task/board-page-state";
import type { ProjectWithTasks } from "@/types/project";
import {
  boardBucketsLoaded,
  loadCompleteColumns,
  loadMoreBoardTasks,
} from "./board-pages";

const loadBoardBucket = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/task/get-tasks", () => ({ loadBoardBucket }));

function board(tasks: string[]) {
  return {
    id: "p",
    columns: [
      {
        id: "todo",
        slug: "todo",
        position: 0,
        tasks: tasks.map((id) => ({ id, status: "todo", labels: [] })),
      },
    ],
    plannedTasks: [],
    archivedTasks: [],
  } as unknown as ProjectWithTasks;
}

function pageState(loadedPages: number, generation = 1): BoardPageState {
  return {
    generation,
    buckets: {
      todo: { loadedPages, totalPages: 3, total: 5, loadedCount: 2 },
    },
  };
}

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
  loadBoardBucket.mockReset();
  queryClient.setQueryData(["tasks", "p"], board(["a", "b"]));
  queryClient.setQueryData(boardPageStateKey("p"), pageState(1));
});

it("appends the next page of one column and records it", async () => {
  loadBoardBucket.mockResolvedValue({
    board: board(["b", "c", "d"]),
    loadedPages: 2,
    totalPages: 3,
    total: 5,
  });
  await expect(loadMoreBoardTasks(queryClient, "p", "todo")).resolves.toBe(
    true,
  );
  expect(loadBoardBucket).toHaveBeenCalledWith("p", "todo", {
    status: "todo",
    fromPage: 2,
    toPage: 2,
  });
  const cached = queryClient.getQueryData<ProjectWithTasks>(["tasks", "p"]);
  expect(cached?.columns[0].tasks.map((task) => task.id)).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
  expect(
    queryClient.getQueryData<BoardPageState>(boardPageStateKey("p"))?.buckets
      .todo,
  ).toEqual({ loadedPages: 2, totalPages: 3, total: 5, loadedCount: 4 });
});

it("drops a page when a full refresh starts while it loads", async () => {
  loadBoardBucket.mockImplementation(async () => {
    queryClient.setQueryData(boardPageStateKey("p"), pageState(1, 2));
    return { board: board(["c"]), loadedPages: 2, totalPages: 3, total: 5 };
  });
  await expect(loadMoreBoardTasks(queryClient, "p", "todo")).resolves.toBe(
    false,
  );
  const cached = queryClient.getQueryData<ProjectWithTasks>(["tasks", "p"]);
  expect(cached?.columns[0].tasks.map((task) => task.id)).toEqual(["a", "b"]);
});

it("completes only the columns a drop touches, synchronously when loaded", async () => {
  expect(boardBucketsLoaded(queryClient, "p", ["todo"])).toBe(false);
  loadBoardBucket.mockResolvedValue({
    board: board(["c", "d", "e"]),
    loadedPages: 3,
    totalPages: 3,
    total: 5,
  });
  const ready = loadCompleteColumns(queryClient, board(["a", "b"]), ["a"]);
  expect(ready).not.toBe(true);
  await expect(ready).resolves.toBe(true);
  expect(loadBoardBucket).toHaveBeenCalledWith("p", "todo", {
    status: "todo",
    fromPage: 2,
    toPage: Number.POSITIVE_INFINITY,
  });
  expect(loadCompleteColumns(queryClient, board(["a"]), ["a"])).toBe(true);
});
