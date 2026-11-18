import { apiOrigin, clientUrl } from "./auth-urls";

const RELATIVE_PATH = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

function matchesOrigin(url: string, trusted: string): boolean {
  if (url.startsWith("/")) return RELATIVE_PATH.test(url);
  const protocol = protocolOf(url);
  return protocol === "http:" || protocol === "https:" || !protocol
    ? trusted === originOf(url)
    : url.startsWith(trusted);
}

/**
 * Whether a post-sign-in redirect target is the web app, the API, or a
 * same-site relative path. Anything else would make the OAuth flow an open
 * redirect.
 */
export function isTrustedCallbackURL(url: string): boolean {
  const trusted = [clientUrl()];
  const own = apiOrigin();
  if (!trusted.includes(own)) trusted.push(own);
  return trusted.some((origin) => matchesOrigin(url, origin));
}
