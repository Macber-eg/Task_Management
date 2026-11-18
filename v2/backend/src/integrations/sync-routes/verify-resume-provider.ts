import { HTTPException } from "../../common/errors/http-exception";
import type { IssueValues, ProviderIssueSnapshot } from "../core/issue-access";
import type { ResumeProviderSnapshot } from "./resume-provider-snapshot";

/**
 * Re-reads the issue after a resume and requires the chosen values and the
 * labels seen at review time; anything else means a missed provider edit.
 */
export async function verifyResumeProvider(
  snapshot: ResumeProviderSnapshot,
  expected: IssueValues,
): Promise<void> {
  let current: ProviderIssueSnapshot;
  try {
    current = await snapshot.access.read();
  } catch {
    throw new HTTPException(502, {
      message: "External issue could not be verified; sync remains paused",
    });
  }
  const initialLabels = [...new Set(snapshot.remoteIssue.labels ?? [])].sort();
  const currentLabels = [...new Set(current.labels ?? [])].sort();
  if (
    current.title !== expected.title ||
    current.description !== expected.description ||
    current.state !== expected.state ||
    initialLabels.length !== currentLabels.length ||
    initialLabels.some((label, index) => label !== currentLabels[index])
  )
    throw new HTTPException(409, {
      message:
        "External issue changed while resuming; review the comparison again",
    });
}
