import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBase, apiOrigin, apiUrl, wsUrl } from "./base-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("base-url", () => {
  it("uses the configured origin and appends /api", () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1338");
    expect(apiOrigin()).toBe("http://localhost:1338");
    expect(apiBase()).toBe("http://localhost:1338/api");
  });

  it("accepts a configured URL that already ends with /api and trailing slashes", () => {
    vi.stubEnv("VITE_API_URL", "https://example.com/api/");
    expect(apiBase()).toBe("https://example.com/api");
    vi.stubEnv("VITE_API_URL", "https://example.com///");
    expect(apiBase()).toBe("https://example.com/api");
  });

  it("falls back to the page origin when VITE_API_URL is empty", () => {
    vi.stubEnv("VITE_API_URL", "");
    expect(apiBase()).toBe(`${window.location.origin}/api`);
  });

  it("joins paths with exactly one slash", () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1338");
    expect(apiUrl("/task/1")).toBe("http://localhost:1338/api/task/1");
    expect(apiUrl("task/1")).toBe("http://localhost:1338/api/task/1");
  });

  it("builds ws and wss URLs", () => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1338");
    expect(wsUrl("ws/user")).toBe("ws://localhost:1338/api/ws/user");
    vi.stubEnv("VITE_API_URL", "https://example.com");
    expect(wsUrl("ws/user")).toBe("wss://example.com/api/ws/user");
  });
});
