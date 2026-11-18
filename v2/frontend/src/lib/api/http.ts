import { apiBase } from "./base-url";
import { refreshSession } from "./refresh-session";
import { windowId } from "./window-id";

// Calls that must never trigger a refresh: they establish, end or renew the
// session themselves, so a 401 from them is the real answer.
const NO_REFRESH_PATHS = [
  "/auth/sign-in/",
  "/auth/sign-up/",
  "/auth/sign-out",
  "/auth/refresh",
  "/auth/request-password-reset",
  "/auth/forget-password",
  "/auth/reset-password",
  "/auth/email-otp/",
];

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function mayRefresh(url: string, init?: RequestInit): boolean {
  if (init?.body instanceof ReadableStream) return false;
  const path = url.split("?")[0] ?? url;
  return !NO_REFRESH_PATHS.some((exempt) => path.includes(`/api${exempt}`));
}

function withDefaults(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Kaneo-Window-Id", windowId);
  return { ...init, headers, credentials: "include" };
}

async function send(input: string | URL | Request, init: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        `Failed to connect to API server at ${apiBase()}. This might be due to CORS configuration issues or the server not running. Please check your environment variables and server status.`,
      );
    }
    throw error;
  }
}

/**
 * `fetch` for the Kaneo API: sends cookies and the tab id, and on a 401
 * renews the session once and retries the request.
 */
export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const requestInit = withDefaults(init);
  const response = await send(input, requestInit);
  if (response.status !== 401 || !mayRefresh(requestUrl(input), init)) {
    return response;
  }
  if (!(await refreshSession())) return response;
  return send(input, requestInit);
}
