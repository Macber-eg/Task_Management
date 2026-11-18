import { expect, it } from "vitest";
import { columnTaskCount } from "./board-page-state";

const partial = { loadedPages: 1, totalPages: 4, total: 180, loadedCount: 50 };

it("shows the server total while later pages are unloaded", () => {
  expect(columnTaskCount(partial, 50)).toBe(180);
});

it("follows live additions and removals since the last page load", () => {
  expect(columnTaskCount(partial, 51)).toBe(181);
  expect(columnTaskCount(partial, 49)).toBe(179);
});

it("counts the loaded tasks once a column is complete or untracked", () => {
  expect(columnTaskCount({ ...partial, loadedPages: 4 }, 12)).toBe(12);
  expect(columnTaskCount(undefined, 7)).toBe(7);
});
