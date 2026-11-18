const DEFAULT_API_URL = "http://localhost:1337";
const DEFAULT_CLIENT_URL = "http://localhost:5173";

/** The API's origin, without any path the configured URL carries. */
export function apiOrigin(): string {
  const apiUrl = process.env.KANEO_API_URL || DEFAULT_API_URL;
  try {
    return new URL(apiUrl).origin;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/");
  }
}

/**
 * Where the auth routes live. OAuth redirect URIs are built from it, so it
 * must keep producing exactly the URIs registered with the providers.
 */
export function authBaseURL(): string {
  return `${apiOrigin()}/api/auth`;
}

export function clientUrl(): string {
  return process.env.KANEO_CLIENT_URL || DEFAULT_CLIENT_URL;
}

/** Where a failed OAuth flow lands when it did not name its own error page. */
export function defaultOAuthErrorURL(): string {
  return `${authBaseURL()}/error`;
}
