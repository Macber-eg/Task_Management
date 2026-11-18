import { describe, expect, it } from "vitest";
import { ALPHANUMERIC, LETTERS, randomString } from "./random-string";

describe("randomString", () => {
  it("returns exactly the requested number of characters from the alphabet", () => {
    expect(randomString(64, LETTERS)).toMatch(/^[a-zA-Z]{64}$/);
    expect(randomString(32, ALPHANUMERIC)).toMatch(/^[a-zA-Z0-9]{32}$/);
    expect(randomString(1, "ab")).toMatch(/^[ab]$/);
  });

  it("uses every character of the alphabet and does not repeat itself", () => {
    const sample = randomString(5_000, ALPHANUMERIC);

    expect(new Set(sample).size).toBe(ALPHANUMERIC.length);
    expect(randomString(64, LETTERS)).not.toBe(randomString(64, LETTERS));
  });
});
