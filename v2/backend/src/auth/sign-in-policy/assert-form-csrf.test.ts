import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertFormCsrf } from "./assert-form-csrf";

function request(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    headers: lower,
    get: (name: string) => lower[name.toLowerCase()],
  } as unknown as Request;
}

describe("assertFormCsrf", () => {
  beforeEach(() => {
    vi.stubEnv("KANEO_CLIENT_URL", "https://app.example.com");
    vi.stubEnv("KANEO_API_URL", "https://api.example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("blocks a cross-site navigation that would start a login", () => {
    expect(() =>
      assertFormCsrf(
        request({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }),
      ),
    ).toThrow(expect.objectContaining({ code: "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED" }));
  });

  it("requires a trusted origin once the browser identifies itself", () => {
    expect(() =>
      assertFormCsrf(request({ "sec-fetch-site": "same-site" })),
    ).toThrow(expect.objectContaining({ code: "MISSING_OR_NULL_ORIGIN" }));
    expect(() =>
      assertFormCsrf(request({ origin: "https://evil.example" })),
    ).toThrow(expect.objectContaining({ code: "INVALID_ORIGIN" }));
    expect(() =>
      assertFormCsrf(
        request({ "sec-fetch-mode": "cors", origin: "https://app.example.com" }),
      ),
    ).not.toThrow();
  });

  it("leaves non-browser clients and cookie-bearing requests alone", () => {
    expect(() => assertFormCsrf(request({}))).not.toThrow();
    expect(() =>
      assertFormCsrf(request({ cookie: "a=b", origin: "https://evil.example" })),
    ).not.toThrow();
  });
});
