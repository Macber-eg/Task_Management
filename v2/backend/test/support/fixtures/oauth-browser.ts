import { CookieJar } from "../cookie-jar";
import type { TestApp } from "../test-app";

export type OAuthBrowser = {
  jar: CookieJar;
  call(path: string, init?: RequestInit): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  /** Opens a URL the API redirected to, without following further redirects. */
  open(url: string): Promise<Response>;
};

/** A browser tab for OAuth flows: keeps cookies, never follows redirects. */
export function oauthBrowser(app: TestApp): OAuthBrowser {
  const jar = new CookieJar();
  async function call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const cookie = jar.header(path);
    if (cookie) headers.set("cookie", cookie);
    const response = await app.request(path, {
      ...init,
      headers,
      redirect: "manual",
    });
    jar.store(response);
    return response;
  }
  return {
    jar,
    call,
    post: (path, body) =>
      call(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:5173",
        },
        body: JSON.stringify(body ?? {}),
      }),
    open: (url) => {
      const parsed = new URL(url);
      return call(`${parsed.pathname}${parsed.search}`);
    },
  };
}

/** The `state` and callback the API put in a provider authorization URL. */
export function authorizationParams(url: string) {
  const params = new URL(url).searchParams;
  return {
    state: params.get("state") ?? "",
    redirectUri: params.get("redirect_uri") ?? "",
    codeChallenge: params.get("code_challenge"),
    scope: params.get("scope"),
    clientId: params.get("client_id"),
  };
}
