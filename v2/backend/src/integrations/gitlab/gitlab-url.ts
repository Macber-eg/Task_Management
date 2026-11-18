import { privateDestinationsAllowed } from "../../common/outbound/assert-public-destination";

export function normalizeGitlabBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("GitLab base URL must use http or https");
  }

  // A query or fragment would break the /api/v4 path appended later.
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(
      "GitLab base URL must not contain a query, fragment, or credentials",
    );
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

// The token travels in a request header, so plain http is only accepted for
// instances on a private network.
export function assertGitlabTransport(baseUrl: string): void {
  if (new URL(baseUrl).protocol === "http:" && !privateDestinationsAllowed()) {
    throw new Error(
      "GitLab URL must use https unless KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS is enabled",
    );
  }
}

// Reject a leading slash or ".." before the path goes into the URL.
export function normalizeProjectPath(path: string): string {
  const segments = path
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);

  if (segments.length < 2) {
    throw new Error(
      "GitLab project path must include a namespace, for example group/project",
    );
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("GitLab project path must not contain relative segments");
  }

  return segments.join("/");
}
