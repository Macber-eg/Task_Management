import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type BoardPageState,
  boardPageStateKey,
} from "@/fetchers/task/board-page-state";

/** Per-column paging of a cached board; written by the board loaders. */
export function useBoardPageState(projectId: string | undefined) {
  return useQuery<BoardPageState>({
    queryKey: boardPageStateKey(projectId ?? ""),
    queryFn: skipToken,
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
}
