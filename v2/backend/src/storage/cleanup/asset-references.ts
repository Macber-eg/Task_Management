const ASSET_URL_PATTERN = /\/api\/asset\/([a-z0-9]+)/gi;

/** Ids of the assets a description, comment or activity links to. */
export function extractAssetIds(
  content: string | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!content) return ids;

  for (const match of content.matchAll(ASSET_URL_PATTERN)) {
    if (match[1]) ids.add(match[1]);
  }

  return ids;
}

export function contentReferencesAsset(
  content: string | null | undefined,
  assetId: string,
): boolean {
  return extractAssetIds(content).has(assetId);
}
