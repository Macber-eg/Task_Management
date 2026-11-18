/**
 * The public origin (and any path prefix) the API is reached at, without
 * `/api`: `KANEO_API_URL` stripped of query, fragment, trailing slashes and
 * the `/api` suffix, as the web image's `env.awk` derived it.
 */
export function publicBaseUrl(): string {
  return (process.env.KANEO_API_URL || "http://localhost:1337")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
}
