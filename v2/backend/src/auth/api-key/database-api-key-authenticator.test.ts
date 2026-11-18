import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyVerifier } from "./api-key-verifier";
import { DatabaseApiKeyAuthenticator } from "./database-api-key-authenticator";

function authenticatorWith(verify: ApiKeyVerifier["verify"]) {
  const verifier = { verify: vi.fn(verify) };
  return {
    verifier,
    authenticator: new DatabaseApiKeyAuthenticator(
      verifier as unknown as ApiKeyVerifier,
    ),
  };
}

const valid = {
  status: "valid" as const,
  rateLimit: null,
  key: { id: "key-1", userId: "user-1", enabled: true, permissions: null },
};

describe("DatabaseApiKeyAuthenticator", () => {
  it("charges a key once per request, however often it is asked", async () => {
    const { verifier, authenticator } = authenticatorWith(async () => valid);
    const request = {} as Request;

    const first = await authenticator.authenticate("k", { consume: true }, request);
    const second = await authenticator.authenticate("k", { consume: true }, request);
    await authenticator.authenticate("k", { consume: true }, {} as Request);

    expect(second).toBe(first);
    expect(verifier.verify).toHaveBeenCalledTimes(2);
  });

  it("repeats a refusal for the same request without asking again", async () => {
    const { verifier, authenticator } = authenticatorWith(async () => ({
      status: "rate_limited",
      limit: 1,
      resetAt: new Date(),
    }));
    const request = {} as Request;

    for (let i = 0; i < 2; i++) {
      await expect(
        authenticator.authenticate("k", { consume: true }, request),
      ).rejects.toMatchObject({ status: 429 });
    }
    expect(verifier.verify).toHaveBeenCalledTimes(1);
  });

  it("never caches a check that spends nothing", async () => {
    const { verifier, authenticator } = authenticatorWith(async () => valid);
    const request = {} as Request;

    await authenticator.authenticate("k", { consume: false }, request);
    await authenticator.authenticate("k", { consume: false }, request);

    expect(verifier.verify).toHaveBeenCalledTimes(2);
  });
});
