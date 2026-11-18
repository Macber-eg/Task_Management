import { describe, expect, it } from "vitest";
import { httpExceptionResponse } from "../../common/errors/http-exception-response";
import { apiKeyRejection } from "./api-key-rejection";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("apiKeyRejection", () => {
  it("answers a rate limited key with JSON and the key's retry headers", async () => {
    const resetAt = new Date(now.getTime() + 30_000);
    const response = await httpExceptionResponse(
      apiKeyRejection({ status: "rate_limited", limit: 10, resetAt }, now),
    );

    expect(response).toEqual({
      status: 429,
      headers: {
        "retry-after": "30",
        "x-ratelimit-limit": "10",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.ceil(resetAt.getTime() / 1000)),
      },
      body: { message: "Rate limit exceeded", code: "RATE_LIMITED" },
    });
  });

  it("uses the refill time for an exhausted quota", async () => {
    const response = await httpExceptionResponse(
      apiKeyRejection(
        {
          status: "usage_exceeded",
          retryAt: new Date(now.getTime() + 120_000),
          rateLimit: null,
        },
        now,
      ),
    );

    expect(response).toEqual({
      status: 429,
      headers: { "retry-after": "120" },
      body: { message: "API key usage limit exceeded", code: "RATE_LIMITED" },
    });
  });

  it("sends no Retry-After for a quota that never refills", async () => {
    const response = await httpExceptionResponse(
      apiKeyRejection(
        { status: "usage_exceeded", retryAt: null, rateLimit: null },
        now,
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers).toEqual({});
  });
});
