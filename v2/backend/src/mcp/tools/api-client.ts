import type { ToolClient } from "./register";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Calls the REST API over HTTP as the MCP caller: the same routes, access
 * rules and events as any other client, with the caller's own bearer token.
 */
export class ApiClient implements ToolClient {
  readonly usingApiKey = false;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async json<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    if (init?.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      ...init,
      headers,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const detail =
        typeof body === "object" && body !== null && "message" in body
          ? (body as { message: string }).message
          : typeof body === "string" && body.length > 0
            ? body.slice(0, 500)
            : `HTTP ${res.status}`;
      throw new Error(`${path}: ${detail}`);
    }
    return body as T;
  }
}
