import { describe, expect, it, vi } from "vite-plus/test";
import { resolveApiBaseUrl } from "./api-url";

describe("resolveApiBaseUrl", () => {
  it("appends /api when the base has no api suffix", () => {
    expect(resolveApiBaseUrl(undefined)).toBe("http://localhost:1337/api");
    expect(resolveApiBaseUrl("http://localhost:1337")).toBe(
      "http://localhost:1337/api",
    );
  });

  it("returns the URL unchanged when it already ends with /api", () => {
    expect(resolveApiBaseUrl("http://localhost:1337/api")).toBe(
      "http://localhost:1337/api",
    );
  });

  it("strips trailing slashes before appending /api", () => {
    expect(resolveApiBaseUrl("http://localhost:1337/")).toBe(
      "http://localhost:1337/api",
    );
    expect(resolveApiBaseUrl("http://localhost:1337/api/")).toBe(
      "http://localhost:1337/api",
    );
  });

  it("uses same-origin /api on a public host when the build still points at localhost", () => {
    vi.stubGlobal("window", {
      location: { hostname: "kaneo-production.up.railway.app", origin: "https://kaneo-production.up.railway.app" },
    });

    expect(resolveApiBaseUrl(undefined)).toBe(
      "https://kaneo-production.up.railway.app/api",
    );
    expect(resolveApiBaseUrl("KANEO_API_URL")).toBe(
      "https://kaneo-production.up.railway.app/api",
    );

    vi.unstubAllGlobals();
  });

  it("keeps an explicit public API URL on a public host", () => {
    vi.stubGlobal("window", {
      location: { hostname: "app.example.com", origin: "https://app.example.com" },
    });

    expect(resolveApiBaseUrl("https://api.example.com")).toBe(
      "https://api.example.com/api",
    );

    vi.unstubAllGlobals();
  });
});
