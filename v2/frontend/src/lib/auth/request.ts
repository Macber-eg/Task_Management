import { apiFetch } from "@/lib/api/http";
import { apiUrl } from "@/lib/api/base-url";
import { toQueryString } from "@/lib/api/query-string";
import { parseAuthJson } from "./revive-dates";
import type { AuthError, AuthFetchOptions, AuthResult } from "./types";

export type AuthRequestInit = {
  method?: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: unknown;
  fetchOptions?: AuthFetchOptions;
};

type SuccessListener = (path: string) => void;

const successListeners = new Set<SuccessListener>();

/** Runs after every successful auth call that did not opt out of signals. */
export function onAuthCallSucceeded(listener: SuccessListener) {
  successListeners.add(listener);
  return () => {
    successListeners.delete(listener);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAuthError(payload: unknown, response: Response): AuthError {
  const body = isRecord(payload)
    ? payload
    : { message: typeof payload === "string" ? payload : undefined };
  return { ...body, status: response.status, statusText: response.statusText };
}

function isSafeRedirect(url: string): boolean {
  try {
    const { protocol } = new URL(url, window.location.href);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// Social sign-in and account linking answer `{ url, redirect: true }`; the
// browser must follow it to the provider.
function followRedirect(payload: unknown) {
  if (!isRecord(payload) || !payload.redirect) return;
  if (typeof payload.url !== "string" || !isSafeRedirect(payload.url)) return;
  window.location.href = payload.url;
}

/** Calls `/api/auth{path}` and answers `{ data, error }` like the better-auth client. */
export async function authRequest<T>(
  path: string,
  { method = "GET", query, body, fetchOptions = {} }: AuthRequestInit = {},
): Promise<AuthResult<T>> {
  const response = await apiFetch(
    apiUrl(`auth${path}`) + toQueryString(query),
    {
      method,
      headers: fetchOptions.headers,
      signal: fetchOptions.signal,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    },
  );
  const payload = parseAuthJson(await response.text());

  if (!response.ok) {
    const error = toAuthError(payload, response);
    await fetchOptions.onError?.({ error, response });
    return { data: null, error };
  }

  await fetchOptions.onSuccess?.({ data: payload, response });
  if (!fetchOptions.disableSignal) {
    for (const listener of successListeners) listener(path);
  }
  followRedirect(payload);
  return { data: payload as T, error: null };
}
