import { describe, expect, it } from "vitest";
import { parseApiKeyPermissions } from "./parse-api-key-permissions";

describe("parseApiKeyPermissions", () => {
  it("treats a key without a stored scope as unrestricted", () => {
    expect(parseApiKeyPermissions(null)).toBeNull();
  });

  it("reads a map of resources to actions", () => {
    expect(
      parseApiKeyPermissions('{"task":["read","update"],"label":[]}'),
    ).toEqual({ task: ["read", "update"], label: [] });
  });

  it.each([
    "not json",
    "null",
    '"task"',
    '["task"]',
    '{"task":"read"}',
    '{"task":["read",1]}',
  ])("grants nothing for the malformed scope %s", (raw) => {
    expect(parseApiKeyPermissions(raw)).toEqual({});
  });
});
