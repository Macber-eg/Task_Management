/** A Cache-Control value that keeps the response out of shared caches. */
export function privateCacheControl(cacheControl: string | null): string {
  if (!cacheControl) return "private";
  if (/\b(private|no-store)\b/i.test(cacheControl)) return cacheControl;
  if (/\bpublic\b/i.test(cacheControl))
    return cacheControl.replace(/\bpublic\b/gi, "private");
  return `private, ${cacheControl}`;
}
