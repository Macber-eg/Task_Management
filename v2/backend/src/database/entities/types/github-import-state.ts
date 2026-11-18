export type GitHubImportState = {
  phase: "issues" | "labels" | "comments" | "pulls" | "complete";
  repositoryId: number;
  startedAt: string;
  issueCursor: string | null;
  pullCursor: string | null;
  moreIssues: boolean;
  currentIssue: {
    number: number;
    taskId: string;
    isNewTask?: boolean;
    labelCursor: string | null;
    commentCursor: string | null;
    moreComments: boolean;
    labelsRemaining: number;
    commentsRemaining: number;
    statusSeen: boolean;
    prioritySeen: boolean;
  } | null;
  imported: number;
  updated: number;
  skipped: number;
};
