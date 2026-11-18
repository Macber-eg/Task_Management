import { useState } from "react";
import { markBoardCacheChanged } from "@/lib/board-cache-version";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BoardPageState,
  boardPageStateKey,
} from "@/fetchers/task/board-page-state";
import getTasks from "@/fetchers/task/get-tasks";
import { useCompleteBoard } from "./use-complete-board";

/**
 * A project's board. Columns load page by page as they scroll; pass `loadAll`
 * when the caller needs every task, such as filters or the backlog.
 */
export function useGetTasks(
  projectId: string,
  { loadAll = false }: { loadAll?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const [progress, setProgress] =
    useState<Awaited<ReturnType<typeof getTasks>>>();
  const query = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: async ({ signal }) => {
      setProgress(undefined);
      markBoardCacheChanged(queryClient, projectId);
      const hasCachedBoard = !!queryClient.getQueryData(["tasks", projectId]);
      let invalidated = false;
      const unsubscribe = hasCachedBoard
        ? () => {}
        : queryClient.getQueryCache().subscribe((event) => {
            if (
              event.query.queryKey[0] !== "tasks" ||
              event.query.queryKey[1] !== projectId
            )
              return;
            if (event.type === "updated" && event.action.type === "invalidate")
              invalidated = true;
            if (
              event.type === "removed" ||
              (event.type === "updated" &&
                event.query.state.fetchStatus === "idle")
            ) {
              unsubscribe();
              if (
                invalidated &&
                !signal.aborted &&
                event.type === "updated" &&
                event.action.type === "success"
              ) {
                queueMicrotask(() => {
                  if (
                    signal.aborted ||
                    !queryClient.getQueryData(["tasks", projectId])
                  )
                    return;
                  void queryClient.invalidateQueries({
                    queryKey: ["tasks", projectId],
                  });
                });
              }
            }
          });
      const pageStateKey = boardPageStateKey(projectId);
      const pageState = queryClient.getQueryData<BoardPageState>(pageStateKey);
      // A new generation drops page loads that started before this refresh.
      const generation = (pageState?.generation ?? 0) + 1;
      queryClient.setQueryData<BoardPageState>(pageStateKey, {
        generation,
        buckets: pageState?.buckets ?? {},
      });
      try {
        return await getTasks(
          projectId,
          signal,
          (board) => {
            if (!hasCachedBoard) setProgress(board);
          },
          {
            pageState,
            onPageState: (buckets) => {
              if (!signal.aborted)
                queryClient.setQueryData<BoardPageState>(pageStateKey, {
                  generation,
                  buckets,
                });
            },
          },
        );
      } catch (error) {
        unsubscribe();
        throw error;
      } finally {
        setProgress(undefined);
      }
    },
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    enabled: !!projectId,
  });
  const data = query.data ?? (query.isFetching ? progress : undefined);
  const completion = useCompleteBoard(
    projectId,
    query.data,
    loadAll,
    query.isFetching,
  );
  return {
    ...query,
    data,
    isFetching: query.isFetching || completion.loading,
    isError: query.isError || completion.failed,
  };
}
