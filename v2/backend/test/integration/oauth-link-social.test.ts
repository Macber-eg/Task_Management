import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialProviderEndpoints } from "../../src/auth/social/providers/social-provider-endpoints";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { createUser } from "../support/fixtures/create-user";
import { insertRow } from "../support/fixtures/insert-row";
import {
  authorizationParams,
  type OAuthBrowser,
  oauthBrowser,
} from "../support/fixtures/oauth-browser";
import { FakeOAuthProvider } from "../support/fixtures/oauth-fake-provider";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const API = "http://localhost:1337";
const WEB = "http://localhost:5173";
const SETTINGS = `${WEB}/settings/account`;

describe("API integration: linking a social account", () => {
  const fake = new FakeOAuthProvider();
  let app: TestApp;

  beforeAll(async () => {
    await fake.start();
    const endpoints = new SocialProviderEndpoints();
    endpoints.github = {
      authorize: fake.url("/github/authorize"),
      token: fake.url("/github/token"),
      user: fake.url("/github/user"),
      emails: fake.url("/github/user/emails"),
    };
    app = await createTestApp({
      realAuth: true,
      overrides: [[SocialProviderEndpoints, endpoints]],
    });
  });

  afterAll(async () => {
    await app.close();
    await fake.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    fake.reset();
    vi.stubEnv("KANEO_API_URL", API);
    vi.stubEnv("KANEO_CLIENT_URL", WEB);
    vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "gh-client");
    vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "gh-secret");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    fake.reply("POST", "/github/token", {
      access_token: "gh-access",
      token_type: "bearer",
      scope: "repo",
    });
    fake.reply("GET", "/github/user", { id: 99, login: "ada-gh", email: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function signedIn(email = "ada@example.com"): Promise<OAuthBrowser> {
    const browser = oauthBrowser(app);
    const response = await browser.post("/api/auth/sign-up/email", {
      name: "Ada",
      email,
      password: "correct horse battery staple",
    });
    expect(response.status).toBe(200);
    return browser;
  }

  async function link(browser: OAuthBrowser) {
    const response = await browser.post("/api/auth/link-social", {
      provider: "github",
      callbackURL: SETTINGS,
      errorCallbackURL: SETTINGS,
    });
    expect(response.status).toBe(200);
    const { url, redirect } = (await response.json()) as {
      url: string;
      redirect: boolean;
    };
    expect(redirect).toBe(true);
    const { state, redirectUri } = authorizationParams(url);
    expect(redirectUri).toBe(`${API}/api/auth/callback/github`);
    const callback = await browser.call(
      `/api/auth/callback/github?code=link-code&state=${state}`,
    );
    expect(callback.status).toBe(302);
    return callback.headers.get("location");
  }

  it("links a GitHub identity with a verified email to the signed-in user", async () => {
    fake.reply("GET", "/github/user/emails", [
      { email: "someone-else@example.com", primary: true, verified: true },
    ]);
    const browser = await signedIn();
    const accessBefore = browser.jar.get("kaneo.access_token");

    // Different emails may be linked; the provider must still vouch for it.
    expect(await link(browser)).toBe(SETTINGS);

    const accounts = await app.db.find(AccountEntity, {
      order: { providerId: "ASC" },
    });
    expect(accounts.map((account) => account.providerId)).toEqual([
      "credential",
      "github",
    ]);
    expect(accounts[1]).toMatchObject({
      accountId: "99",
      userId: accounts[0]?.userId,
      accessToken: "gh-access",
      scope: "repo",
    });
    // Linking does not start a new login.
    expect(browser.jar.get("kaneo.access_token")).toBe(accessBefore);

    const listed = await browser.call("/api/auth/list-accounts");
    const providers = ((await listed.json()) as { providerId: string }[]).map(
      (account) => account.providerId,
    );
    expect(providers).toContain("github");
  });

  it("refuses to link an identity whose email the provider did not verify", async () => {
    fake.reply("GET", "/github/user/emails", [
      { email: "ada@example.com", primary: true, verified: false },
    ]);
    const browser = await signedIn();
    expect(await link(browser)).toBe(`${SETTINGS}?error=unable_to_link_account`);
    expect(await app.db.countBy(AccountEntity, { providerId: "github" })).toBe(0);
  });

  it("keeps an identity linked to another user with that user", async () => {
    fake.reply("GET", "/github/user/emails", [
      { email: "ada@example.com", primary: true, verified: true },
    ]);
    const other = await createUser(app.db, { email: "grace@example.com" });
    await insertRow(app.db, AccountEntity, {
      id: "acc-other",
      accountId: "99",
      providerId: "github",
      userId: other.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const browser = await signedIn();
    expect(await link(browser)).toBe(
      `${SETTINGS}?error=account_already_linked_to_different_user`,
    );
    const account = await app.db.findOneByOrFail(AccountEntity, {
      id: "acc-other",
    });
    expect(account.userId).toBe(other.id);
  });

  it("requires a signed-in user, not an API key", async () => {
    const anonymous = oauthBrowser(app);
    const response = await anonymous.post("/api/auth/link-social", {
      provider: "github",
      callbackURL: SETTINGS,
    });
    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toMatchObject({ code: "UNAUTHORIZED" });

    const user = await createUser(app.db);
    const { key } = await seedApiKey(app.db, user.id);
    const withKey = await app.request("/api/auth/link-social", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ provider: "github", callbackURL: SETTINGS }),
    });
    expect(withKey.status).toBe(401);
  });
});
