import { describe, expect, it } from "vitest";
import {
  admin,
  builtInRoles,
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
  member,
  owner,
  statement,
  viewer,
} from "./index";

describe("permission statement surface", () => {
  it("exposes the resource statements alongside the organization defaults", () => {
    expect(statement.project).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "share",
    ]);
    expect(statement.task).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "assign",
    ]);
    expect(statement.label).toEqual(["create", "read", "update", "delete"]);
    expect(statement.workspace).toEqual([
      "read",
      "update",
      "delete",
      "manage_settings",
    ]);
    // The member/admin/owner roles reuse the organization statements, and
    // stored roles are checked against them (organization:update).
    expect(statement.organization).toBeDefined();
    expect(statement.member).toBeDefined();
  });
});

describe("built-in role privileges", () => {
  it("viewer can read but cannot create or modify", () => {
    expect(viewer.statements.project).toEqual(["read"]);
    expect(viewer.statements.task).toEqual(["read"]);
    expect(viewer.statements.label).toEqual(["read"]);
    expect(viewer.statements.workspace).toEqual(["read"]);
  });

  it("member can create/read/update tasks but not delete or manage settings", () => {
    expect(member.statements.task).toContain("create");
    expect(member.statements.task).toContain("update");
    expect(member.statements.task).not.toContain("delete");
    expect(member.statements.project).toContain("create");
    expect(member.statements.project).not.toContain("delete");
    expect(member.statements.workspace).toEqual(["read"]);
  });

  it("admin can delete tasks and manage workspace settings but cannot delete the workspace", () => {
    expect(admin.statements.task).toContain("delete");
    expect(admin.statements.task).toContain("assign");
    expect(admin.statements.project).toContain("delete");
    expect(admin.statements.project).toContain("share");
    expect(admin.statements.workspace).toContain("manage_settings");
    expect(admin.statements.workspace).not.toContain("delete");
  });

  it("owner has every resource action including workspace:delete", () => {
    expect(owner.statements.task).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete", "assign"]),
    );
    expect(owner.statements.project).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete", "share"]),
    );
    expect(owner.statements.workspace).toEqual(
      expect.arrayContaining(["read", "update", "delete", "manage_settings"]),
    );
  });

  it("groups all four roles under builtInRoles by name", () => {
    expect(Object.keys(builtInRoles).sort()).toEqual([
      "admin",
      "member",
      "owner",
      "viewer",
    ]);
    expect(builtInRoles.viewer).toBe(viewer);
    expect(builtInRoles.member).toBe(member);
    expect(builtInRoles.admin).toBe(admin);
    expect(builtInRoles.owner).toBe(owner);
  });
});

describe("default-role seed payloads", () => {
  it("names the seedable defaults but excludes owner (kept as static role)", () => {
    expect(DEFAULT_ROLE_NAMES).toEqual(["viewer", "member", "admin"]);
    expect(DEFAULT_ROLE_NAMES).not.toContain("owner");
    expect(Object.keys(defaultRolePayloads).sort()).toEqual([
      "admin",
      "member",
      "viewer",
    ]);
  });

  it("emits JSON-serializable payloads that mirror each role's compiled statements", () => {
    for (const name of DEFAULT_ROLE_NAMES) {
      const role = builtInRoles[name];
      const payload = defaultRolePayloads[name];

      // Every resource the compiled role declares must appear in the payload
      // with the same set of actions (order-insensitive). Otherwise a seeded
      // workspace_role row would silently drift from the static role.
      for (const [resource, actions] of Object.entries(role.statements)) {
        expect(payload[resource]).toBeDefined();
        expect([...(payload[resource] ?? [])].sort()).toEqual(
          [...actions].sort(),
        );
      }

      // Round-trips through JSON without loss; the API stores these as text.
      const roundTripped: unknown = JSON.parse(JSON.stringify(payload));
      expect(roundTripped).toEqual(payload);
    }
  });

  it("returns a fresh mutable array per resource so callers can edit safely", () => {
    const tasks = defaultRolePayloads.member.task ?? [];
    tasks.push("__test_marker");
    try {
      // The payload is a copy: editing it leaves the role's statements alone.
      expect(defaultRolePayloads.member.task).toContain("__test_marker");
      expect(member.statements.task).not.toContain("__test_marker");
    } finally {
      tasks.pop();
    }
  });
});
