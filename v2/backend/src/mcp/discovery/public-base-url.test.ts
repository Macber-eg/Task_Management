import { afterEach, describe, expect, it, vi } from "vitest";
import { publicBaseUrl } from "./public-base-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicBaseUrl", () => {
  it.each([
    ["http://public.test:5273/api", "http://public.test:5273"],
    ["http://public.test:5273/api/", "http://public.test:5273"],
    ["http://public.test:5273///", "http://public.test:5273"],
    ["https://kaneo.example/sub/api?x=1#y", "https://kaneo.example/sub"],
    ["https://kaneo.example/apis", "https://kaneo.example/apis"],
  ])("derives %s as %s", (apiUrl, expected) => {
    vi.stubEnv("KANEO_API_URL", apiUrl);
    expect(publicBaseUrl()).toBe(expected);
  });

  it("defaults to the local API", () => {
    vi.stubEnv("KANEO_API_URL", "");
    expect(publicBaseUrl()).toBe("http://localhost:1337");
  });
});
