import { describe, expect, it } from "vitest";
import { contentReferencesAsset, extractAssetIds } from "./asset-references";

describe("extractAssetIds", () => {
  it("extracts asset IDs from content with /api/asset/ URLs", () => {
    const content =
      '<p>Hello <img src="http://localhost:1337/api/asset/abc123" /> world <img src="/api/asset/def456" /></p>';
    expect(extractAssetIds(content)).toEqual(new Set(["abc123", "def456"]));
  });

  it("returns empty set for null/undefined/empty content", () => {
    expect(extractAssetIds(null)).toEqual(new Set());
    expect(extractAssetIds(undefined)).toEqual(new Set());
    expect(extractAssetIds("")).toEqual(new Set());
  });

  it("returns empty set when no asset URLs are present", () => {
    expect(extractAssetIds("<p>No images here</p>")).toEqual(new Set());
  });

  it("deduplicates repeated asset IDs", () => {
    const content = "/api/asset/abc123 and again /api/asset/abc123";
    expect(extractAssetIds(content)).toEqual(new Set(["abc123"]));
  });

  it("does not treat asset ID prefixes as references", () => {
    expect(contentReferencesAsset("/api/asset/abc123xyz", "abc123")).toBe(
      false,
    );
    expect(contentReferencesAsset("/api/asset/abc123", "abc123")).toBe(true);
  });
});
