// The one place the app reads its build-time configuration. `VITE_API_URL` is
// the backend origin (with or without a trailing `/api`); empty means the API
// is served from the same origin as the app.

function configuredApiUrl(): string {
  return (import.meta.env.VITE_API_URL ?? "").trim();
}

/** Backend origin, e.g. `http://localhost:1338`. */
export function apiOrigin(): string {
  const configured = configuredApiUrl()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  return configured || window.location.origin;
}

/** Base URL every REST call is made under, e.g. `http://localhost:1338/api`. */
export function apiBase(): string {
  return `${apiOrigin()}/api`;
}

/** The API base as resolved when the app loaded. */
export const API_BASE = apiBase();

/** Absolute URL of an API path: `apiUrl("task/1")` → `…/api/task/1`. */
export function apiUrl(path: string): string {
  return `${apiBase()}/${path.replace(/^\/+/, "")}`;
}

/** Absolute WebSocket URL of an API path: `wsUrl("ws/user")` → `ws://…/api/ws/user`. */
export function wsUrl(path: string): string {
  return apiUrl(path).replace(/^http/, "ws");
}
