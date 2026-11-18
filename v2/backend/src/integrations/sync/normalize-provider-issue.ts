import type { ProviderIssueSnapshot } from "../core/issue-access";
import { formatTaskDescriptionFromIssue } from "../links/issue-format";

/** A provider's issue payload as the sync engine compares it. */
export type RawProviderIssue = {
  title: string;
  body?: string | null;
  description?: string | null;
  state: string;
  updated_at?: string;
  content_version?: number;
  labels?: Array<string | { name?: string }>;
};

/** Maps a GitHub/Gitea/GitLab issue to a snapshot, dropping the task footer. */
export function normalizeProviderIssue(
  issue: RawProviderIssue,
  taskId: string,
): ProviderIssueSnapshot {
  return {
    title: issue.title,
    description: formatTaskDescriptionFromIssue(
      issue.body ?? issue.description ?? "",
      taskId,
    ),
    state: issue.state === "closed" ? "closed" : "open",
    updatedAt: issue.updated_at ?? null,
    contentVersion: issue.content_version ?? null,
    labels: (issue.labels ?? []).flatMap((label) => {
      const name = typeof label === "string" ? label : label.name;
      return name ? [name] : [];
    }),
  };
}

/** The issue number a link points at; throws for anything else. */
export function linkedIssueNumber(externalId: string): number {
  const number = Number(externalId);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error("Invalid issue number");
  return number;
}
