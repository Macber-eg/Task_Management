import { describe, expect, it } from "vitest";
import { parseAuthJson } from "./revive-dates";

describe("parseAuthJson", () => {
  it("revives ISO timestamps to Date", () => {
    const parsed = parseAuthJson(
      '{"createdAt":"2026-01-02T03:04:05.678Z","nested":[{"at":"2026-01-02T03:04:05+02:00"}]}',
    ) as { createdAt: Date; nested: { at: Date }[] };

    expect(parsed.createdAt).toBeInstanceOf(Date);
    expect(parsed.createdAt.toISOString()).toBe("2026-01-02T03:04:05.678Z");
    expect(parsed.nested[0]?.at.toISOString()).toBe("2026-01-02T01:04:05.000Z");
  });

  it("leaves dates without a time and other strings alone", () => {
    expect(parseAuthJson('{"day":"2026-01-02","name":"x"}')).toEqual({
      day: "2026-01-02",
      name: "x",
    });
  });

  it("returns null for empty bodies and the text for non-JSON", () => {
    expect(parseAuthJson("")).toBeNull();
    expect(parseAuthJson("null")).toBeNull();
    expect(parseAuthJson("Too many requests")).toBe("Too many requests");
  });
});
