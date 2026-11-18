import { describe, expect, it } from "vitest";
import { hashApiKey } from "./hash-api-key";

describe("hashApiKey", () => {
  it("matches the hashes the previous backend stored", () => {
    // The plain base64 digest of this key is
    // "xsli/4qjhzwZrholCd8+w4dDGq+rjgktVJaLejKufFk=": it has every character
    // the URL-safe, unpadded form rewrites.
    expect(hashApiKey("kaneo_test_key_2")).toBe(
      "xsli_4qjhzwZrholCd8-w4dDGq-rjgktVJaLejKufFk",
    );
  });
});
