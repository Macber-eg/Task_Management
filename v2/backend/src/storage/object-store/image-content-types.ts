/**
 * Image types served inline and accepted as project backgrounds. Anything
 * else is stored as an attachment and downloaded, never rendered.
 */
export const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isImageContentType(contentType: string) {
  return IMAGE_CONTENT_TYPES.has(contentType.toLowerCase());
}

/** The media type of a `Content-Type` value, lower-cased, without parameters. */
export function baseContentType(value: string) {
  return value.toLowerCase().split(";")[0]?.trim() ?? "";
}
