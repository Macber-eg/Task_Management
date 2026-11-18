type CookieAttributeUrls = {
  apiUrl: string;
  clientUrl: string;
  cookieDomain?: string;
};

/**
 * Cookies are `SameSite=Lax` unless the API and the web app are on different
 * HTTPS hosts, where the browser would not send a Lax cookie on the app's
 * requests; then they are `None; Secure; Partitioned`.
 */
export function getDefaultCookieAttributes({
  apiUrl,
  clientUrl,
  cookieDomain,
}: CookieAttributeUrls) {
  const parsedApiUrl = (() => {
    try {
      return new URL(apiUrl);
    } catch {
      return undefined;
    }
  })();
  const isHttps = parsedApiUrl?.protocol === "https:";
  const isCrossSubdomain = (() => {
    try {
      const apiHost = parsedApiUrl?.hostname;
      const clientHost = new URL(clientUrl).hostname;
      return (
        apiHost !== undefined &&
        apiHost !== clientHost &&
        apiHost !== "localhost" &&
        clientHost !== "localhost"
      );
    } catch {
      return false;
    }
  })();

  return {
    sameSite:
      isCrossSubdomain && isHttps ? ("none" as const) : ("lax" as const),
    secure: isHttps,
    partitioned: isCrossSubdomain && isHttps,
    domain: cookieDomain || undefined,
  };
}

export function resolveCookieAttributes() {
  return getDefaultCookieAttributes({
    apiUrl: process.env.KANEO_API_URL || "http://localhost:1337",
    clientUrl: process.env.KANEO_CLIENT_URL || "http://localhost:5173",
    cookieDomain: process.env.COOKIE_DOMAIN,
  });
}
