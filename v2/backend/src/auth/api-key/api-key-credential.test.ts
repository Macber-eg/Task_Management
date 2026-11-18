import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { apiKeyCredential } from "./api-key-credential";

function request(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { get: (name: string) => lower[name.toLowerCase()] } as Request;
}

describe("apiKeyCredential", () => {
  it("prefers x-api-key, trimmed, over a Bearer token", () => {
    expect(
      apiKeyCredential(
        request({ "x-api-key": "  header-key ", authorization: "Bearer other" }),
      ),
    ).toEqual({ key: "header-key", fromBearer: false });
  });

  it("falls back to an opaque Bearer token", () => {
    expect(apiKeyCredential(request({ authorization: "Bearer opaque" }))).toEqual(
      { key: "opaque", fromBearer: true },
    );
  });

  it.each([
    [{}],
    [{ "x-api-key": "   " }],
    [{ authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln" }],
    [{ authorization: "Bearer two parts" }],
    [{ authorization: "Basic dXNlcjpwYXNz" }],
  ])("finds no key in %j", (headers) => {
    expect(apiKeyCredential(request(headers))).toBeNull();
  });
});
