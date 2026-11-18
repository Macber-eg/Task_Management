import { describe, expect, it } from "vitest";
import { checkWorkspaceName } from "./check-workspace-name";

describe("checkWorkspaceName", () => {
  it("accepts normal workspace names", () => {
    expect(checkWorkspaceName("Acme Inc.").ok).toBe(true);
    expect(checkWorkspaceName("My Team – Project").ok).toBe(true);
    expect(checkWorkspaceName("Crypto Snack").ok).toBe(true);
  });

  it("rejects names with embedded URLs (2026-05-28 phishing pattern)", () => {
    expect(
      checkWorkspaceName("BANK OPER https://ij5205.craftum.io/page2").ok,
    ).toBe(false);
  });

  it("rejects names longer than 100 characters", () => {
    expect(checkWorkspaceName("a".repeat(101)).ok).toBe(false);
  });

  it("rejects names with HTML / template chars", () => {
    expect(checkWorkspaceName("<!DOCTYPE html><script>").ok).toBe(false);
    expect(checkWorkspaceName("hello {{name}}").ok).toBe(false);
  });

  it("rejects empty / whitespace-only names", () => {
    expect(checkWorkspaceName("").ok).toBe(false);
    expect(checkWorkspaceName("   ").ok).toBe(false);
  });

  it("returns the rejection reason as a string", () => {
    const result = checkWorkspaceName("a".repeat(150));
    expect(result).toEqual({
      ok: false,
      reason: "Workspace name must be 100 characters or fewer.",
    });
  });
});
