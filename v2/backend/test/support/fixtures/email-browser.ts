import { CookieJar } from "../cookie-jar";
import type { TestApp } from "../test-app";

export type EmailBrowser = {
  jar: CookieJar;
  call(path: string, init?: RequestInit): Promise<Response>;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  post(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response>;
};

/**
 * A browser tab that has not signed in yet: keeps the cookies responses set
 * and sends `headers` (an Origin, a user agent) with every request.
 */
export function openBrowser(
  app: TestApp,
  headers: Record<string, string> = {},
): EmailBrowser {
  const jar = new CookieJar();
  async function call(path: string, init: RequestInit = {}) {
    const merged = new Headers(headers);
    for (const [name, value] of new Headers(init.headers)) {
      merged.set(name, value);
    }
    const cookie = jar.header(path);
    if (cookie) merged.set("cookie", cookie);
    const response = await app.request(path, {
      redirect: "manual",
      ...init,
      headers: merged,
    });
    jar.store(response);
    return response;
  }
  return {
    jar,
    call,
    get: (path, extra) => call(path, { headers: extra }),
    post: (path, body, extra) =>
      call(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...extra },
        body: JSON.stringify(body ?? {}),
      }),
  };
}

/** The first link in an email whose URL contains `fragment`. */
export function linkIn(html: string, fragment: string): URL {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = (match[1] ?? "").replaceAll("&amp;", "&");
    if (href.includes(fragment)) return new URL(href);
  }
  throw new Error(`No link containing ${fragment} in the email`);
}
