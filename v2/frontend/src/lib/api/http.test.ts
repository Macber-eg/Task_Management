import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_URL", "http://api.test");
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

describe("apiFetch", () => {
  it("sends cookies, the window id and a JSON content type", async () => {
    const { apiFetch } = await import("./http");
    fetchMock.mockResolvedValueOnce(json(200));

    await apiFetch("http://api.test/api/task/1", { method: "GET" });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(init?.credentials).toBe("include");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Kaneo-Window-Id")).toBeTruthy();
  });

  it("leaves the content type to the browser for FormData", async () => {
    const { apiFetch } = await import("./http");
    fetchMock.mockResolvedValueOnce(json(200));

    await apiFetch("http://api.test/api/upload", {
      method: "POST",
      body: new FormData(),
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("refreshes once on a 401 and retries the request", async () => {
    const { apiFetch } = await import("./http");
    fetchMock
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, { token: "t" }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    const response = await apiFetch("http://api.test/api/task/1");

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://api.test/api/auth/refresh",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns the 401 when the refresh fails", async () => {
    const { apiFetch } = await import("./http");
    fetchMock
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(401, { code: "SESSION_EXPIRED" }));

    const response = await apiFetch("http://api.test/api/task/1");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one refresh between concurrent 401s", async () => {
    const { apiFetch } = await import("./http");
    const seen = new Set<string>();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return json(200);
      if (seen.has(url)) return json(200);
      seen.add(url);
      return json(401);
    });

    await Promise.all([
      apiFetch("http://api.test/api/a"),
      apiFetch("http://api.test/api/b"),
    ]);

    const refreshes = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/auth/refresh"),
    );
    expect(refreshes).toHaveLength(1);
  });

  it("does not refresh for sign-in and other session endpoints", async () => {
    const { apiFetch } = await import("./http");
    fetchMock.mockResolvedValue(json(401));

    await apiFetch("http://api.test/api/auth/sign-in/email", {
      method: "POST",
    });
    await apiFetch("http://api.test/api/auth/refresh", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains connection failures", async () => {
    const { apiFetch } = await import("./http");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(apiFetch("http://api.test/api/task")).rejects.toThrow(
      "Failed to connect to API server at http://api.test/api",
    );
  });
});
