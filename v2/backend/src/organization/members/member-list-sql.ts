export const MEMBER_FILTER_OPERATORS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "not_in",
  "contains",
  "starts_with",
  "ends_with",
] as const;

export type MemberFilterOperator = (typeof MEMBER_FILTER_OPERATORS)[number];

export type MemberFilter = {
  field: string;
  operator?: MemberFilterOperator;
  value: unknown;
};

// Clients name membership fields as the previous API exposed them.
const MEMBER_COLUMNS: Record<string, string> = {
  id: "id",
  organizationId: "workspace_id",
  userId: "user_id",
  role: "role",
  createdAt: "joined_at",
};

/** The column behind a member field; an unknown field is a server error, as before. */
export function memberColumn(field: string): string {
  const column = MEMBER_COLUMNS[field];
  if (!column) {
    throw new Error(`The field "${field}" does not exist in the "member" schema`);
  }
  return column;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** One SQL condition for the filter, using `$${param}` for its value. */
export function memberFilterSql(
  filter: MemberFilter,
  param: number,
): { sql: string; value: unknown } {
  const column = memberColumn(filter.field);
  const placeholder = `$${param}`;
  const list = Array.isArray(filter.value) ? filter.value : [filter.value];
  switch (filter.operator ?? "eq") {
    case "ne":
      return { sql: `${column} <> ${placeholder}`, value: filter.value };
    case "lt":
      return { sql: `${column} < ${placeholder}`, value: filter.value };
    case "lte":
      return { sql: `${column} <= ${placeholder}`, value: filter.value };
    case "gt":
      return { sql: `${column} > ${placeholder}`, value: filter.value };
    case "gte":
      return { sql: `${column} >= ${placeholder}`, value: filter.value };
    case "in":
      return {
        sql: `${column}::text = ANY(${placeholder}::text[])`,
        value: list.map(String),
      };
    case "not_in":
      return {
        sql: `NOT (${column}::text = ANY(${placeholder}::text[]))`,
        value: list.map(String),
      };
    case "contains":
      return {
        sql: `${column}::text LIKE ${placeholder}`,
        value: `%${escapeLike(String(filter.value))}%`,
      };
    case "starts_with":
      return {
        sql: `${column}::text LIKE ${placeholder}`,
        value: `${escapeLike(String(filter.value))}%`,
      };
    case "ends_with":
      return {
        sql: `${column}::text LIKE ${placeholder}`,
        value: `%${escapeLike(String(filter.value))}`,
      };
    default:
      return { sql: `${column} = ${placeholder}`, value: filter.value };
  }
}
