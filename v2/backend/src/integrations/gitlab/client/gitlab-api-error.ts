export type GitlabApiErrorKind =
  | "REDIRECT"
  | "INVALID_JSON"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "EMPTY_RESPONSE";

export class GitlabApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: GitlabApiErrorKind,
    public body?: string,
  ) {
    super(message);
    this.name = "GitlabApiError";
  }
}

/** The value, or a `GitlabApiError` when GitLab answered with no body. */
export function requiredGitlabResponse<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new GitlabApiError(
      `GitLab ${what} response was empty`,
      500,
      "EMPTY_RESPONSE",
    );
  }
  return value;
}

/** GitLab's transient "409 Conflict: Resource lock" on concurrent edits. */
export function isResourceLock(error: unknown): boolean {
  if (!(error instanceof GitlabApiError) || error.status !== 409) return false;
  try {
    return (
      JSON.parse(error.body ?? "null")?.message ===
      "409 Conflict: Resource lock"
    );
  } catch {
    return false;
  }
}
