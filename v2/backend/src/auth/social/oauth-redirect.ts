/**
 * Ends an OAuth callback with a browser redirect. Thrown from deep in the
 * flow and turned into a 302 by the controller, the way the previous
 * backend's callbacks redirected on any failure.
 */
export class OAuthRedirect extends Error {
  constructor(readonly location: string) {
    super("OAuth redirect");
    this.name = "OAuthRedirect";
  }
}

/** Redirects to the error page with a machine-readable `error` parameter. */
export function redirectOnError(
  errorURL: string,
  error: string,
  description?: string,
): never {
  const params = new URLSearchParams({ error });
  if (description) params.set("error_description", description);
  const separator = errorURL.includes("?") ? "&" : "?";
  throw new OAuthRedirect(`${errorURL}${separator}${params.toString()}`);
}
