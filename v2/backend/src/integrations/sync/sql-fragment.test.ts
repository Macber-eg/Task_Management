import { describe, expect, it } from "vitest";
import { joinSql, sql } from "./sql-fragment";

describe("sql fragments", () => {
  it("numbers placeholders across nested and joined fragments", () => {
    const names = joinSql(
      ["a", "b"].map((name) => sql`${name}`),
      ", ",
    );
    const predicate = sql`name in (${names}) and id = ${7}`;
    expect(sql`select ${1} where ${predicate}`.render()).toEqual({
      text: "select $1 where name in ($2, $3) and id = $4",
      values: [1, "a", "b", 7],
    });
  });
});
