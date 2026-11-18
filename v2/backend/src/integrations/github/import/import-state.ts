import type { GitHubImportState } from "../../../database/entities/types/github-import-state";

export function initialImportState(repositoryId: number): GitHubImportState {
  return {
    phase: "issues",
    repositoryId,
    startedAt: new Date().toISOString(),
    issueCursor: null,
    pullCursor: null,
    moreIssues: true,
    currentIssue: null,
    imported: 0,
    updated: 0,
    skipped: 0,
  };
}

/** The import summary the routes answer (and the integration shows). */
export function importProgress(runId: string, state: GitHubImportState) {
  return {
    runId,
    pending: state.phase !== "complete",
    imported: state.imported,
    updated: state.updated,
    skipped: state.skipped,
  };
}
