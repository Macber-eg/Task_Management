// `_` and `%` are wildcards to ILIKE and `\` is its default escape character:
// a search term must go through here or it matches more rows than asked for.
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
