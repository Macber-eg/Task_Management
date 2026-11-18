import type { IssueAccess, ProviderIssueSnapshot } from "../core/issue-access";

/** The provider issue as read once per resume, reused by every phase. */
export type ResumeProviderSnapshot = {
  access: IssueAccess;
  remoteIssue: ProviderIssueSnapshot;
};
