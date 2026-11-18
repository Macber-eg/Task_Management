import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bucketHasMore } from "@/fetchers/task/board-page-state";
import { useBoardPageState } from "@/hooks/queries/task/use-board-page-state";
import { loadMoreBoardTasks } from "@/lib/board-pages";

type LoadMoreTasksProps = {
  projectId: string;
  status: string;
};

/** Sits after a column's last card and loads its next page when scrolled into view. */
export function LoadMoreTasks({ projectId, status }: LoadMoreTasksProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bucket = useBoardPageState(projectId)?.buckets[status];
  const hasMore = bucketHasMore(bucket);
  const sentinel = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // The bucket a load was skipped for; it waits for the next recorded pages.
  const skippedFor = useRef<typeof bucket>(undefined);

  const loadMore = useCallback(() => {
    const requestedFor = bucket;
    setLoading(true);
    setFailed(false);
    loadMoreBoardTasks(queryClient, projectId, status)
      .then((loaded) => {
        if (!loaded) skippedFor.current = requestedFor;
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [bucket, projectId, queryClient, status]);

  // Observing again after every recorded page makes the observer report the
  // sentinel's position in the new layout, so a page that pushed it out of
  // view does not trigger another one. A load skipped during a full board
  // refresh is retried once that refresh records its pages.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !bucket || !hasMore || loading || failed) return;
    if (skippedFor.current === bucket) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [bucket, failed, hasMore, loadMore, loading]);

  if (!hasMore) return null;

  return (
    <div ref={sentinel} className="px-1 py-2 text-xs text-muted-foreground">
      {failed ? (
        <p role="alert">
          {t("tasks:board.loadMoreTasksFailed")}{" "}
          <button type="button" className="underline" onClick={loadMore}>
            {t("tasks:board.loadMoreTasksRetry")}
          </button>
        </p>
      ) : (
        <p role="status" aria-live="polite">
          {loading ? t("tasks:board.loadingMoreTasks") : null}
        </p>
      )}
    </div>
  );
}
