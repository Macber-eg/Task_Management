import { describe, expect, it } from "vitest";
import type { ApikeyEntity } from "../../database/entities/apikey.entity";
import { toApiKeyOutput } from "./api-key-output";

const createdAt = new Date("2026-01-01T00:00:00.000Z");

function apiKey(overrides: Partial<ApikeyEntity> = {}): ApikeyEntity {
  return {
    id: "key-1",
    configId: "default",
    name: "CI",
    start: "abcdef",
    referenceId: "user-1",
    prefix: null,
    key: "stored-hash",
    userId: "user-1",
    refillInterval: null,
    refillAmount: null,
    lastRefillAt: null,
    enabled: true,
    rateLimitEnabled: true,
    rateLimitTimeWindow: 60_000,
    rateLimitMax: 100,
    requestCount: 0,
    remaining: null,
    lastRequest: null,
    expiresAt: null,
    createdAt,
    updatedAt: createdAt,
    permissions: null,
    metadata: null,
    ...overrides,
  };
}

describe("toApiKeyOutput", () => {
  it("never includes the stored hash or the legacy owner column", () => {
    const output = toApiKeyOutput(apiKey());

    expect(output).not.toHaveProperty("key");
    expect(output).not.toHaveProperty("userId");
    expect(output).toMatchObject({
      id: "key-1",
      configId: "default",
      referenceId: "user-1",
      start: "abcdef",
      createdAt,
      permissions: null,
      metadata: null,
    });
  });

  it("parses the stored scope", () => {
    expect(
      toApiKeyOutput(apiKey({ permissions: '{"task":["read"]}' })).permissions,
    ).toEqual({ task: ["read"] });
  });

  it.each([
    ["the text null", "null", null],
    ["an object", '{"team":"ops"}', { team: "ops" }],
    ["an object encoded twice", '"{\\"team\\":\\"ops\\"}"', { team: "ops" }],
    ["text that is not JSON", "ops", null],
  ])("reads metadata stored as %s", (_, metadata, expected) => {
    expect(toApiKeyOutput(apiKey({ metadata })).metadata).toEqual(expected);
  });
});
