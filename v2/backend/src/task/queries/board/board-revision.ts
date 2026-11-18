/**
 * SQL aggregate fingerprinting the rows a public board page depends on, so
 * a reader paging through it can tell when it changed. Private boards skip
 * the work and report "0". `fields` are SQL expressions.
 */
export function boardRevisionSql(
  publicOnly: boolean | undefined,
  fields: string[],
) {
  return publicOnly
    ? `coalesce(sum(hashtextextended(jsonb_build_array(${fields.join(", ")})::text, 0)::numeric), 0)::text`
    : `'0'`;
}
