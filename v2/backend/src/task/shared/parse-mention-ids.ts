const MENTION_PATTERN = /<kaneo-mention[^>]*\bid="([^"]+)"/gi;

/** Users @mentioned in a body: the editor's `<kaneo-mention id="...">` tags. */
export function parseMentionIds(content: string | null | undefined): string[] {
  const ids = new Set<string>();
  if (!content) return [];
  for (const match of content.matchAll(MENTION_PATTERN)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}
