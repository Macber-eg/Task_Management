export const BOARD_DESCRIPTION_MAX_BYTES = 64 * 1024;
export const DESCRIPTION_CHUNK_CHARACTERS = 32 * 1024;
export const DESCRIPTION_MATCH_PAGE_SIZE = 100;

/** True when a description is too large for list views. `column` is SQL. */
export function descriptionDeferredSql(column: string) {
  return `coalesce(octet_length(${column}) > ${BOARD_DESCRIPTION_MAX_BYTES}, false)`;
}

/** The description, or null when list views defer it. `column` is SQL. */
export function boardDescriptionSql(column: string) {
  return `case when ${descriptionDeferredSql(column)} then null else ${column} end`;
}
