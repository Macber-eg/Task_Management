import { apiUrl } from "./base-url";
import { windowId } from "./window-id";

const LOCK_NAME = "kaneo.auth.refresh";
const LAST_REFRESH_KEY = "kaneo.auth.refreshed-at";
// Another tab that refreshed this recently already rotated the shared cookie.
const RECENT_REFRESH_MS = 5_000;

let inFlight: Promise<boolean> | null = null;

function readLastRefresh(): number {
  try {
    return Number(localStorage.getItem(LAST_REFRESH_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastRefresh() {
  try {
    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable (private mode); refreshing still works.
  }
}

async function requestRefresh(startedAt: number): Promise<boolean> {
  if (readLastRefresh() > startedAt - RECENT_REFRESH_MS) {
    return true;
  }
  try {
    const response = await fetch(apiUrl("auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "X-Kaneo-Window-Id": windowId },
    });
    if (response.ok) writeLastRefresh();
    return response.ok;
  } catch {
    return false;
  }
}

async function runRefresh(): Promise<boolean> {
  const startedAt = Date.now();
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return requestRefresh(startedAt);
  // Tabs share the refresh cookie, so only one of them rotates it at a time.
  return locks.request(LOCK_NAME, () => requestRefresh(startedAt));
}

/**
 * Renews the access cookie from the refresh cookie. Concurrent callers in a
 * tab share one request; resolves `false` when the session has expired.
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= runRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
