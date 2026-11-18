export function uploadTooLargeMessage(maxBytes: number) {
  return `Upload exceeds the maximum upload size of ${Math.floor(maxBytes / (1024 * 1024))}MB.`;
}
