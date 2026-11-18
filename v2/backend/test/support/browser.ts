import { expect } from "vitest";
import { CookieJar } from "./cookie-jar";
import type { TestApp } from "./test-app";

export type Browser = {
  jar: CookieJar;
  userId: string;
  call(path: string, init?: RequestInit): Promise<Response>;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
};

const PASSWORD = "correct horse battery staple";

/**
 * Signs a new user up through the real auth endpoints and returns a client
 * that keeps the session cookies, like a browser tab. The first user of an
 * empty instance becomes its administrator.
 */
export async function signUpBrowser(
  app: TestApp,
  email: string,
  name = "Browser user",
): Promise<Browser> {
  const jar = new CookieJar();
  async function call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const cookie = jar.header(path);
    if (cookie) headers.set("cookie", cookie);
    const response = await app.request(path, { ...init, headers });
    jar.store(response);
    return response;
  }
  const post = (path: string, body?: unknown) =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

  const signUp = await post("/api/auth/sign-up/email", {
    name,
    email,
    password: PASSWORD,
  });
  expect(signUp.status).toBe(200);
  const { user } = (await signUp.json()) as { user: { id: string } };

  return { jar, userId: user.id, call, get: (path) => call(path), post };
}
