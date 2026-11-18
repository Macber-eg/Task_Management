import { describe, expect, it } from "vitest";
import { workingDaysBetween } from "./working-days-between";

describe("workingDaysBetween", () => {
  it("counts weekdays inclusively and skips weekends", () => {
    // 2026-01-05 is a Monday.
    expect(
      workingDaysBetween(
        new Date("2026-01-05T09:00:00"),
        new Date("2026-01-11T18:00:00"),
      ),
    ).toBe(5);
    expect(
      workingDaysBetween(
        new Date("2026-01-05T00:00:00"),
        new Date("2026-01-05T23:00:00"),
      ),
    ).toBe(1);
  });

  it("is zero for a reversed range", () => {
    expect(
      workingDaysBetween(
        new Date("2026-01-09T00:00:00"),
        new Date("2026-01-05T00:00:00"),
      ),
    ).toBe(0);
  });
});
