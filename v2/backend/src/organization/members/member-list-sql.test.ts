import { describe, expect, it } from "vitest";
import { memberColumn, memberFilterSql } from "./member-list-sql";

describe("member list SQL", () => {
  it("maps the fields clients name to membership columns", () => {
    expect(memberColumn("organizationId")).toBe("workspace_id");
    expect(memberColumn("createdAt")).toBe("joined_at");
    expect(memberColumn("role")).toBe("role");
  });

  it("refuses a field the member has not got", () => {
    expect(() => memberColumn("password")).toThrow(/does not exist/);
  });

  it("defaults to equality", () => {
    expect(memberFilterSql({ field: "role", value: "admin" }, 2)).toEqual({
      sql: "role = $2",
      value: "admin",
    });
  });

  it("matches lists and substrings", () => {
    expect(
      memberFilterSql({ field: "role", operator: "in", value: ["admin"] }, 3),
    ).toEqual({ sql: "role::text = ANY($3::text[])", value: ["admin"] });
    expect(
      memberFilterSql({ field: "role", operator: "contains", value: "ad_" }, 2),
    ).toEqual({ sql: "role::text LIKE $2", value: "%ad\\_%" });
  });
});
