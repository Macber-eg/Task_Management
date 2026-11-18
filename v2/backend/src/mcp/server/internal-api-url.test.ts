import { afterEach, describe, expect, it, vi } from "vitest";
import { internalApiUrl } from "./internal-api-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("internalApiUrl", () => {
  it.each(["http://api.internal:1337/api/", "http://api.internal:1337/"])(
    "uses the configured URL %s without /api or duplicate slashes",
    (configured) => {
      vi.stubEnv("KANEO_INTERNAL_API_URL", configured);
      expect(internalApiUrl(4000)).toBe("http://api.internal:1337");
    },
  );

  it("falls back to this server over loopback on the request's port", () => {
    vi.stubEnv("KANEO_INTERNAL_API_URL", "");
    expect(internalApiUrl(4000)).toBe("http://127.0.0.1:4000");
  });

  it("falls back to the configured port, then 1337, without a socket port", () => {
    vi.stubEnv("KANEO_INTERNAL_API_URL", "");
    vi.stubEnv("PORT", "");
    expect(internalApiUrl(undefined)).toBe("http://127.0.0.1:1337");
  });
});
