import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { openBrowser } from "../support/fixtures/email-browser";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const PASSWORD = "correct horse battery";
const DAY_MS = 24 * 60 * 60 * 1000;

function setCookie(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`));
}

describe("remember me and the last-used sign-in method", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    const signUp = await openBrowser(app).post("/api/auth/sign-up/email", {
      name: "Ada",
      email: "ada@example.com",
      password: PASSWORD,
    });
    expect(signUp.status).toBe(200);
    expect(
      setCookie(signUp, "better-auth.last_used_login_method"),
    ).toContain("better-auth.last_used_login_method=email");
  });

  it("records the method in a 30-day cookie the web app can read", async () => {
    const response = await openBrowser(app).post("/api/auth/sign-in/email", {
      email: "ada@example.com",
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const cookie = setCookie(response, "better-auth.last_used_login_method");
    expect(cookie).toMatch(/^better-auth\.last_used_login_method=email;/);
    expect(cookie).toContain("Max-Age=2592000");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  it("keeps a rememberMe: false login to one day and the browser session", async () => {
    const tab = openBrowser(app);
    const response = await tab.post("/api/auth/sign-in/email", {
      email: "ada@example.com",
      password: PASSWORD,
      rememberMe: false,
    });
    expect(response.status).toBe(200);
    const refresh = setCookie(response, "kaneo.refresh_token");
    expect(refresh).toBeDefined();
    expect(refresh).not.toMatch(/Expires=|Max-Age=/i);

    const sessionId = tab.jar.get("kaneo.refresh_token")?.split(".")[0] ?? "";
    const created = await app.db.findOneByOrFail(SessionEntity, {
      id: sessionId,
    });
    const lifetime = created.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(DAY_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(DAY_MS);

    const rotated = await tab.post("/api/auth/refresh");
    expect(rotated.status).toBe(200);
    expect(setCookie(rotated, "kaneo.refresh_token")).not.toMatch(
      /Expires=|Max-Age=/i,
    );
    const after = await app.db.findOneByOrFail(SessionEntity, {
      id: sessionId,
    });
    expect(after.expiresAt.getTime()).toBe(created.expiresAt.getTime());
  });

  it("keeps a remembered login for a week and extends it on refresh", async () => {
    const tab = openBrowser(app);
    const response = await tab.post("/api/auth/sign-in/email", {
      email: "ada@example.com",
      password: PASSWORD,
    });
    expect(setCookie(response, "kaneo.refresh_token")).toMatch(/Expires=/);
    const sessionId = tab.jar.get("kaneo.refresh_token")?.split(".")[0] ?? "";
    const created = await app.db.findOneByOrFail(SessionEntity, {
      id: sessionId,
    });
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * DAY_MS);
  });
});
