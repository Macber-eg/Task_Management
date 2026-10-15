const UNRENDERED_API_URL_PLACEHOLDER = "KANEO_API_URL";

function looksLikeLocalDevApiUrl(value: string | undefined): boolean {
  if (!value || value === UNRENDERED_API_URL_PLACEHOLDER) {
    return true;
  }

  const withoutApi = value.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  try {
    const url = new URL(
      withoutApi.startsWith("http") ? withoutApi : `http://${withoutApi}`,
    );
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Resolves the Hono client base URL from `VITE_API_URL` (or default).
 * If the value already ends with `/api`, it is returned as-is; otherwise `/api` is appended.
 *
 * When the bundled image is served on a public host but runtime env substitution
 * did not run, fall back to same-origin `/api` (nginx proxies to the API process).
 */
export function resolveApiBaseUrl(viteApiUrl: string | undefined): string {
  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    looksLikeLocalDevApiUrl(viteApiUrl)
  ) {
    return `${window.location.origin}/api`;
  }

  const raw = viteApiUrl || "http://localhost:1337";
  const baseUrl = raw.replace(/\/+$/, "");
  return baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
}
