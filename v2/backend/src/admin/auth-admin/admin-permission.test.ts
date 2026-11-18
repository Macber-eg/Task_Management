import { describe, expect, it } from "vitest";
import { hasAdminPermission } from "./admin-permission";

describe("hasAdminPermission", () => {
  it("grants administrators every user and session action", () => {
    expect(hasAdminPermission("admin", { user: ["list"] })).toBe(true);
    expect(
      hasAdminPermission("admin", {
        user: ["ban", "delete", "set-role"],
        session: ["revoke"],
      }),
    ).toBe(true);
  });

  it("recognizes admin inside a role list", () => {
    expect(hasAdminPermission("user,admin", { user: ["update"] })).toBe(true);
  });

  it("refuses users, unknown roles and a missing role", () => {
    for (const role of ["user", "owner", null, undefined, ""]) {
      expect(hasAdminPermission(role, { user: ["list"] })).toBe(false);
    }
  });

  it("requires every action of every resource", () => {
    expect(
      hasAdminPermission("admin", { user: ["list", "impersonate-admins"] }),
    ).toBe(false);
    expect(hasAdminPermission("admin", { project: ["list"] })).toBe(false);
    expect(hasAdminPermission("admin", { user: [] })).toBe(false);
    expect(hasAdminPermission("admin", {})).toBe(false);
  });
});
