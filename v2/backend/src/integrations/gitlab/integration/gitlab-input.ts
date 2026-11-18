import { HTTPException } from "../../../common/errors/http-exception";
import {
  assertGitlabTransport,
  normalizeGitlabBaseUrl,
  normalizeProjectPath,
} from "../gitlab-url";

function orBadRequest<T>(normalize: () => T): T {
  try {
    return normalize();
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : "Invalid GitLab input",
    });
  }
}

/** The normalized base URL from a request, or a 400 explaining the problem. */
export function parseGitlabBaseUrl(url: string): string {
  return orBadRequest(() => {
    const normalized = normalizeGitlabBaseUrl(url);
    assertGitlabTransport(normalized);
    return normalized;
  });
}

/** The normalized project path from a request, or a 400. */
export function parseGitlabProjectPath(path: string): string {
  return orBadRequest(() => normalizeProjectPath(path));
}
