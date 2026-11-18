/** The issue fields a sync resume compares and may write. */
export type IssueValues = {
  title: string;
  description: string;
  state: "open" | "closed";
};

/**
 * A provider issue as the sync engine sees it. `description` has the Kaneo
 * task footer removed (see `normalizeProviderIssue`).
 */
export type ProviderIssueSnapshot = IssueValues & {
  updatedAt: string | null;
  /** Gitea's optimistic-concurrency version, when the provider has one. */
  contentVersion: number | null;
  labels: string[];
};

/**
 * Reads and writes one linked issue. `write` must apply exactly the given
 * values and return the issue as the provider answered.
 */
export type IssueAccess = {
  read(): Promise<ProviderIssueSnapshot>;
  write(values: IssueValues): Promise<ProviderIssueSnapshot>;
};
