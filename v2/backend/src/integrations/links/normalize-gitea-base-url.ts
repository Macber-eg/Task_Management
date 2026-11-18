/**
 * The canonical form of a Gitea instance URL. Part of an issue link's edit
 * scope (`issueEditScope`), so the Gitea provider must store base URLs in
 * this form too.
 */
export function normalizeGiteaBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Gitea base URL must use http or https");
  }

  // A query or fragment would swallow the appended /api/v1/... path and let a
  // caller aim the request at an arbitrary path on the target host.
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(
      "Gitea base URL must not contain a query, fragment, or credentials",
    );
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}
