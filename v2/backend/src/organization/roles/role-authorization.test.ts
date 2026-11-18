import { describe, expect, it } from "vitest";
import { defaultRolePayloads } from "../../permissions";
import { rolesAuthorize, workspaceRoleStatements } from "./role-authorization";

const seeded = (["viewer", "member", "admin"] as const).map((role) => ({
  role,
  permission: JSON.stringify(defaultRolePayloads[role]),
}));

describe("workspace role authorization", () => {
  it("grants the owner everything from code, with or without stored rows", () => {
    const roles = workspaceRoleStatements([]);
    expect(
      rolesAuthorize(roles, "owner", { organization: ["delete"], ac: ["update"] }),
    ).toBe(true);
  });

  it("grants a default role nothing when its row is missing", () => {
    const roles = workspaceRoleStatements([]);
    expect(rolesAuthorize(roles, "admin", { label: ["read"] })).toBe(false);
  });

  it("reads default and custom roles from their stored rows", () => {
    const roles = workspaceRoleStatements([
      ...seeded,
      { role: "client", permission: JSON.stringify({ task: ["read"] }) },
    ]);
    expect(rolesAuthorize(roles, "admin", { member: ["update"] })).toBe(true);
    expect(rolesAuthorize(roles, "viewer", { task: ["create"] })).toBe(false);
    expect(rolesAuthorize(roles, "client", { task: ["read"] })).toBe(true);
  });

  it("adds a stored owner row to the owner's fixed statements", () => {
    const roles = workspaceRoleStatements([
      { role: "owner", permission: JSON.stringify({ task: [] }) },
    ]);
    expect(rolesAuthorize(roles, "owner", { task: ["delete"] })).toBe(true);
  });

  it("passes when any of a member's roles grants every action", () => {
    const roles = workspaceRoleStatements(seeded);
    expect(rolesAuthorize(roles, "viewer,admin", { project: ["delete"] })).toBe(
      true,
    );
    expect(
      rolesAuthorize(roles, "member", { task: ["read", "delete"] }),
    ).toBe(false);
  });

  it("refuses an empty request, an empty action list and no request", () => {
    const roles = workspaceRoleStatements(seeded);
    expect(rolesAuthorize(roles, "admin", {})).toBe(false);
    expect(rolesAuthorize(roles, "admin", { task: [] })).toBe(false);
    expect(rolesAuthorize(roles, "admin", undefined)).toBe(false);
  });

  it("lets an owner past every check only when asked to", () => {
    const roles = workspaceRoleStatements([]);
    expect(rolesAuthorize(roles, "owner", { unknown: ["x"] })).toBe(false);
    expect(rolesAuthorize(roles, "owner", { unknown: ["x"] }, true)).toBe(true);
  });

  it("rejects a stored role whose permission is not a statement map", () => {
    expect(() =>
      workspaceRoleStatements([{ role: "broken", permission: '{"task":"x"}' }]),
    ).toThrow("Invalid permissions for role broken");
  });
});
