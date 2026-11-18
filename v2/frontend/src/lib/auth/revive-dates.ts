// Same pattern the better-auth client used: full ISO-8601 timestamps with a
// time part and a zone become `Date`s; plain dates and other strings stay text.
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;

function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

/** Parses an auth response body; empty bodies become `null`. */
export function parseAuthJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text, reviveDates) as unknown;
  } catch {
    return text;
  }
}
