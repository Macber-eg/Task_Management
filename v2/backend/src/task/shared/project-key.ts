export function isSameProjectKey(a: string, b: string) {
  return (
    a.normalize("NFKC").toLowerCase() === b.normalize("NFKC").toLowerCase()
  );
}

/**
 * SQL narrowing candidate projects for a key; `isSameProjectKey` decides.
 * Slugs with multi-byte characters always pass, since SQL lower() and NFKC
 * folding can disagree on them. `project` is the table alias, `key` a bind
 * placeholder holding the NFKC-normalized key.
 */
export function mayMatchProjectKeySql(project: string, key: string) {
  return `(lower(${project}.slug) = lower(${key})
    OR octet_length(${project}.slug) <> char_length(${project}.slug))`;
}
