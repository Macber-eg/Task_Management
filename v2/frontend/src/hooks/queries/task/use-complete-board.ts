import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  allBoardStatuses,
  boardBucketsLoaded,
  loadAllBoardBuckets,
} from "@/lib/board-pages";
import type { ProjectWithTasks } from "@/types/project";
import { useBoardPageState } from "./use-board-page-state";

/**
 * Loads every remaining page of a board while `enabled`, for views that need
 * all tasks at once: filters, search, sorting, backlog and timelines.
 */
export function useCompleteBoard(
  projectId: string,
  board: ProjectWithTasks | undefined,
  enabled: boolean,
  fetching: boolean,
) {
  const queryClient = useQueryClient();
  // Re-render as pages are recorded so completeness below stays current.
  useBoardPageState(projectId);
  const running = useRef(false);
  const [failed, setFailed] = useState(false);
  const [, setSettled] = useState(0);
  const complete =
    !board ||
    boardBucketsLoaded(queryClient, projectId, allBoardStatuses(board));

  useEffect(() => {
    if (fetching) setFailed(false);
  }, [fetching]);

  useEffect(() => {
    if (!enabled || !board || fetching || complete || failed) return;
    if (running.current) return;
    running.current = true;
    loadAllBoardBuckets(queryClient, projectId, allBoardStatuses(board))
      .catch(() => setFailed(true))
      .finally(() => {
        running.current = false;
        setSettled((count) => count + 1);
      });
  }, [board, complete, enabled, failed, fetching, projectId, queryClient]);

  return {
    loading: enabled && !!board && !complete && !failed,
    failed: enabled && failed,
  };
}
