/** `?a=1&b=x&b=y` from an object; arrays repeat the key, null/undefined are skipped. */
export function toQueryString(query: Record<string, unknown> | undefined) {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined || item === null) continue;
      search.append(key, String(item));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
