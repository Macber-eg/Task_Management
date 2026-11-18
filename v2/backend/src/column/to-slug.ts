/**
 * A column's slug: its name normalized (NFKC, lower case) with every run of
 * other characters collapsed to "-". Empty when no letter or digit remains.
 */
export function toSlug(name: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return /[\p{L}\p{N}]/u.test(slug) ? slug : "";
}
