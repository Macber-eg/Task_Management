import { assertPublicDestination } from "../../../common/outbound/assert-public-destination";
import { normalizeGiteaBaseUrl } from "../../links/normalize-gitea-base-url";
import { GiteaApiError } from "./gitea-api-error";

const GITEA_FETCH_TIMEOUT_MS = 10_000;

/**
 * Calls the Gitea REST API (`/api/v1{path}`) of a user-configured instance:
 * the destination must be public (unless private destinations are allowed),
 * redirects are refused and the request times out after 10 seconds. Answers
 * undefined for an empty body.
 */
export async function giteaFetch<T>(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T | undefined> {
  const root = normalizeGiteaBaseUrl(baseUrl);
  const url = `${root}/api/v1${path.startsWith("/") ? path : `/${path}`}`;

  await assertPublicDestination(root, "Gitea");

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, GITEA_FETCH_TIMEOUT_MS);
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
      // Following redirects would let a public host bounce the request to an
      // internal address after the destination check has already passed.
      redirect: "manual",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (res.status >= 300 && res.status < 400) {
      throw new GiteaApiError(
        `Gitea request was redirected (HTTP ${res.status})`,
        res.status,
        "REDIRECT",
      );
    }

    const text = await res.text();
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new GiteaApiError(
        `Gitea API error ${res.status}`,
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
      throw new GiteaApiError(
        "Gitea API returned invalid JSON",
        res.status,
        "INVALID_JSON",
        text,
      );
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (
      !(error instanceof GiteaApiError) &&
      error instanceof Error &&
      error.name === "AbortError" &&
      timedOut
    ) {
      throw new GiteaApiError(
        `Gitea request timed out after ${GITEA_FETCH_TIMEOUT_MS}ms`,
        408,
        "TIMEOUT",
      );
    }
    throw error;
  }
}
