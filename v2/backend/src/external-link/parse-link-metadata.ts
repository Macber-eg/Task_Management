/** Link metadata is stored as a JSON string and answered parsed. */
export function parseLinkMetadata(metadata: string | null): unknown {
  return metadata ? (JSON.parse(metadata) as unknown) : null;
}
