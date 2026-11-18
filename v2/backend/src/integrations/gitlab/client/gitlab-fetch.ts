import { assertPublicDestination } from "../../../common/outbound/assert-public-destination";
import type { GitlabTokenType } from "../config";
import { assertGitlabTransport, normalizeGitlabBaseUrl } from "../gitlab-url";
import { GitlabApiError } from "./gitlab-api-error";

const GITLAB_FETCH_TIMEOUT_MS = 10_000;

function authHeaders(
  token: string,
  tokenType: GitlabTokenType,
): Record<string, string> {
  return {
    ...(tokenType === "bearer"
      ? { Authorization: `Bearer ${token}` }
      : { "PRIVATE-TOKEN": token }),
    "Content-Type": "application/json",
  };
}

/**
 * Calls the GitLab REST API (`/api/v4{path}`) of a user-configured instance:
 * the destination must be public (unless private destinations are allowed)
 * and use https, redirects are refused and the request times out after 10
 * seconds. Answers undefined for an empty body.
 */
export async function gitlabFetch<T>(
  baseUrl: string,
  token: string,
  tokenType: GitlabTokenType,
  path: string,
  init?: RequestInit,
): Promise<T | undefined> {
  const root = normalizeGitlabBaseUrl(baseUrl);
  const url = `${root}/api/v4${path.startsWith("/") ? path : `/${path}`}`;

  await assertPublicDestination(root, "GitLab");
  assertGitlabTransport(root);

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, GITLAB_FETCH_TIMEOUT_MS);
  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      // A redirect could lead past the destination check to an internal host.
      redirect: "manual",
      headers: {
        ...authHeaders(token, tokenType),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    if (res.status >= 300 && res.status < 400) {
      throw new GitlabApiError(
        `GitLab request was redirected (HTTP ${res.status})`,
        res.status,
        "REDIRECT",
      );
    }

    const text = await res.text();
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new GitlabApiError(
        `GitLab API error ${res.status}`,
        res.status,
        "HTTP_ERROR",
        text,
      );
    }

    if (res.status === 204 || text === "") {
      return undefined;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GitlabApiError(
        "GitLab API returned invalid JSON",
        res.status,
        "INVALID_JSON",
        text,
      );
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (
      !(error instanceof GitlabApiError) &&
      error instanceof Error &&
      error.name === "AbortError" &&
      timedOut
    ) {
      throw new GitlabApiError(
        `GitLab request timed out after ${GITLAB_FETCH_TIMEOUT_MS}ms`,
        408,
        "TIMEOUT",
      );
    }
    throw error;
  }
}
