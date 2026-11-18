import { describe, expect, it } from "vitest";
import { resolveDuration } from "./duration";
import { isIsoTimestamp } from "./iso-timestamp";

describe("resolveDuration", () => {
  it("is null while running and whole seconds once closed", () => {
    const start = new Date("2026-01-01T09:00:00.000Z");
    expect(resolveDuration(start)).toBeNull();
    expect(resolveDuration(start, new Date("2026-01-01T10:30:00.999Z"))).toBe(
      5400,
    );
  });

  it("rejects a reversed or overflowing range", () => {
    expect(() =>
      resolveDuration(
        new Date("2026-01-01T10:00:00Z"),
        new Date("2026-01-01T09:00:00Z"),
      ),
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(() =>
      resolveDuration(
        new Date("1900-01-01T00:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toThrow(
      expect.objectContaining({
        status: 400,
        message: "The time range is too long to record.",
      }),
    );
  });
});

describe("isIsoTimestamp", () => {
  it("accepts ISO timestamps with an offset", () => {
    expect(isIsoTimestamp("2026-01-31T09:00:00Z")).toBe(true);
    expect(isIsoTimestamp("2026-01-31T09:00+02:00")).toBe(true);
    expect(isIsoTimestamp("2026-01-31T09:00:00.123456789Z")).toBe(true);
  });

  it("rejects other formats and impossible calendar dates", () => {
    expect(isIsoTimestamp("not-a-date")).toBe(false);
    expect(isIsoTimestamp("01/02/2026")).toBe(false);
    expect(isIsoTimestamp("2026-01-31T09:00:00")).toBe(false);
    expect(isIsoTimestamp("2026-02-30T10:00:00Z")).toBe(false);
  });
});
