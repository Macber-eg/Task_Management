import { describe, expect, it } from "vitest";
import {
  isOAuthCallbackPath,
  normalizeInvitationId,
} from "./registration-policy";

describe("normalizeInvitationId", () => {
  it("trims and accepts id-shaped values", () => {
    expect(normalizeInvitationId("  abc_DEF-123 ")).toBe("abc_DEF-123");
    expect(normalizeInvitationId("a".repeat(128))).toHaveLength(128);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "   ",
    "a".repeat(129),
    "id with space",
    "a/b",
    "a;b",
  ])("drops %j", (value) => {
    expect(normalizeInvitationId(value)).toBeUndefined();
  });
});

describe("isOAuthCallbackPath", () => {
  it.each(["/callback/github", "/oauth2/callback/custom"])(
    "accepts %s",
    (path) => {
      expect(isOAuthCallbackPath(path)).toBe(true);
    },
  );

  it.each([
    "/sign-up/email",
    "/callback",
    "/api/auth/callback/github",
    7,
    undefined,
  ])("rejects %j", (path) => {
    expect(isOAuthCallbackPath(path)).toBe(false);
  });
});
