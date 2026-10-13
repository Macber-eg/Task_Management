import { describe, expect, it } from "vite-plus/test";
import {
  effectiveTaskEstimateMinutes,
  minutesFromHoursAndMinutes,
  summarizeEffort,
  sumEffortForTaskIds,
} from "./metrics";

describe("summarizeEffort", () => {
  it("computes variance and utilization", () => {
    const summary = summarizeEffort(20 * 60, 25 * 3600);
    expect(summary.varianceMinutes).toBe(5 * 60);
    expect(summary.utilizationPercent).toBe(125);
    expect(summary.overEstimate).toBe(true);
    expect(summary.remainingMinutes).toBe(0);
  });

  it("handles zero estimate without divide by zero", () => {
    const summary = summarizeEffort(null, 3600);
    expect(summary.utilizationPercent).toBeNull();
    expect(summary.overEstimate).toBe(false);
  });
});

describe("effectiveTaskEstimateMinutes", () => {
  it("rolls up subtask estimates for parents", () => {
    const estimates = new Map([
      ["parent", 999],
      ["child-a", 60],
      ["child-b", 30],
    ]);
    const subtasks = new Map([["parent", ["child-a", "child-b"]]]);
    expect(effectiveTaskEstimateMinutes("parent", estimates, subtasks)).toBe(
      90,
    );
    expect(effectiveTaskEstimateMinutes("child-a", estimates, subtasks)).toBe(
      60,
    );
  });
});

describe("sumEffortForTaskIds", () => {
  it("aggregates multiple tasks", () => {
    const estimates = new Map([
      ["t1", 60],
      ["t2", 30],
    ]);
    const actual = new Map([
      ["t1", 3600],
      ["t2", 1800],
    ]);
    const totals = sumEffortForTaskIds(
      ["t1", "t2"],
      estimates,
      actual,
      new Map(),
    );
    expect(totals.estimatedMinutes).toBe(90);
    expect(totals.actualSeconds).toBe(5400);
  });
});

describe("minutesFromHoursAndMinutes", () => {
  it("parses hours and minutes", () => {
    expect(minutesFromHoursAndMinutes(2, 30)).toBe(150);
  });
});
