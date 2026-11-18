import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialProviderEndpoints } from "../../src/auth/social/providers/social-provider-endpoints";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { VerificationEntity } from "../../src/database/entities/verification.entity";
import { createInvitation } from "../support/fixtures/create-invitation";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import {
  authorizationParams,
  type OAuthBrowser,
  oauthBrowser,
} from "../support/fixtures/oauth-browser";
import { FakeOAuthProvider, fakeIdToken } from "../support/fixtures/oauth-fake-provider";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const API = "http://localhost:1337";
const WEB = "http://localhost:5173";
const CALLBACKS = {
  callbackURL: `${WEB}/dashboard`,
  errorCallbackURL: `${WEB}/auth/sign-in`,
  newUserCallbackURL: `${WEB}/onboarding`,
};

describe("API integration: social sign-in", () => {
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
    endpoints.google = {
      authorize: fake.url("/google/authorize"),
      token: fake.url("/google/token"),
    };
    endpoints.discord = {
      authorize: fake.url("/discord/authorize"),
      token: fake.url("/discord/token"),
      user: fake.url("/discord/users/@me"),
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
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
    vi.stubEnv("DISCORD_CLIENT_ID", "discord-client");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "discord-secret");
    vi.stubEnv("DISABLE_REGISTRATION", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function githubUser(
    profile: Record<string, unknown> = {},
    emails: unknown[] = [
      { email: "octo@example.com", primary: true, verified: true },
    ],
  ) {
    fake.reply("POST", "/github/token", {
      access_token: "gh-access",
      token_type: "bearer",
      scope: "read:user,user:email",
    });
    fake.reply("GET", "/github/user", {
      id: 4242,
      login: "octocat",
      name: "Octo Cat",
      email: null,
      avatar_url: "https://avatars.example.com/octo.png",
      ...profile,
    });
    fake.reply("GET", "/github/user/emails", emails);
  }

  async function startSignIn(
    browser: OAuthBrowser,
    body: Record<string, unknown> = { provider: "github", ...CALLBACKS },
  ) {
    const response = await browser.post("/api/auth/sign-in/social", body);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { url: string; redirect: boolean };
    return { response, json, params: authorizationParams(json.url) };
  }

  async function finish(browser: OAuthBrowser, provider: string, state: string) {
    const response = await browser.call(
      `/api/auth/callback/${provider}?code=provider-code&state=${state}`,
    );
    expect(response.status).toBe(302);
    return response.headers.get("location") ?? "";
  }

  it("registers a new GitHub user, signs them in and sends them to the new-user page", async () => {
    githubUser();
    const browser = oauthBrowser(app);
    const { response, json, params } = await startSignIn(browser);

    expect(json.redirect).toBe(true);
    expect(response.headers.get("location")).toBe(json.url);
    expect(json.url.startsWith(fake.url("/github/authorize"))).toBe(true);
    expect(params.redirectUri).toBe(`${API}/api/auth/callback/github`);
    expect(params.clientId).toBe("gh-client");
    expect(params.scope).toBe("read:user user:email user:email");
    expect(params.codeChallenge).toBeTruthy();
    expect(await app.db.count(VerificationEntity)).toBe(1);

    const location = await finish(browser, "github", params.state);
    expect(location).toBe(CALLBACKS.newUserCallbackURL);

    const [tokenRequest] = fake.requestsTo("POST", "/github/token");
    expect(tokenRequest?.body).toMatchObject({
      grant_type: "authorization_code",
      code: "provider-code",
      redirect_uri: `${API}/api/auth/callback/github`,
      client_id: "gh-client",
      client_secret: "gh-secret",
    });
    expect(tokenRequest?.body.code_verifier).toHaveLength(128);

    expect(browser.jar.get("kaneo.access_token")).toBeTruthy();
    expect(browser.jar.get("kaneo.refresh_token")).toBeTruthy();
    expect(browser.jar.get("better-auth.last_used_login_method")).toBe("github");
    expect(await app.db.count(VerificationEntity)).toBe(0);

    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "octo@example.com",
    });
    expect(user).toMatchObject({
      name: "Octo Cat",
      emailVerified: true,
      image: "https://avatars.example.com/octo.png",
      // The first account on an instance becomes its administrator.
      role: "admin",
    });
    const account = await app.db.findOneByOrFail(AccountEntity, {
      userId: user.id,
    });
    expect(account).toMatchObject({
      providerId: "github",
      accountId: "4242",
      accessToken: "gh-access",
      scope: "read:user,user:email",
      password: null,
    });

    const session = await browser.call("/api/auth/get-session");
    expect(((await session.json()) as { user: { id: string } }).user.id).toBe(
      user.id,
    );
  });

  it("signs a returning user in to the callback URL and refreshes the stored tokens", async () => {
    githubUser();
    const first = oauthBrowser(app);
    const firstStart = await startSignIn(first);
    expect(await finish(first, "github", firstStart.params.state)).toBe(
      CALLBACKS.newUserCallbackURL,
    );

    fake.reply("POST", "/github/token", {
      access_token: "gh-access-2",
      token_type: "bearer",
      scope: "read:user",
    });
    const again = oauthBrowser(app);
    const { params } = await startSignIn(again);
    expect(await finish(again, "github", params.state)).toBe(CALLBACKS.callbackURL);

    expect(await app.db.count(UserEntity)).toBe(1);
    const accounts = await app.db.find(AccountEntity);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      accessToken: "gh-access-2",
      scope: "read:user",
    });
  });

  it("links GitHub to an existing account only when both sides verified the email", async () => {
    const local = await createUser(app.db, {
      email: "octo@example.com",
      emailVerified: true,
    });
    githubUser();
    const browser = oauthBrowser(app);
    const { params } = await startSignIn(browser);
    expect(await finish(browser, "github", params.state)).toBe(
      CALLBACKS.callbackURL,
    );
    const account = await app.db.findOneByOrFail(AccountEntity, {
      providerId: "github",
    });
    expect(account.userId).toBe(local.id);
  });

  it("refuses implicit linking to an existing account whose email is unverified", async () => {
    await createUser(app.db, { email: "octo@example.com", emailVerified: false });
    githubUser();
    const browser = oauthBrowser(app);
    const { params } = await startSignIn(browser);
    expect(await finish(browser, "github", params.state)).toBe(
      `${CALLBACKS.errorCallbackURL}?error=account_not_linked`,
    );
    expect(await app.db.count(AccountEntity)).toBe(0);
    expect(browser.jar.get("kaneo.access_token")).toBeUndefined();
  });

  it("refuses implicit linking when the provider did not verify the email", async () => {
    await createUser(app.db, { email: "octo@example.com", emailVerified: true });
    githubUser({}, [{ email: "octo@example.com", primary: true, verified: false }]);
    const browser = oauthBrowser(app);
    const { params } = await startSignIn(browser);
    expect(await finish(browser, "github", params.state)).toBe(
      `${CALLBACKS.errorCallbackURL}?error=account_not_linked`,
    );
  });

  it("rejects a callback whose state was started in another browser, and a replayed state", async () => {
    githubUser();
    const starter = oauthBrowser(app);
    const { params } = await startSignIn(starter);

    const attacker = oauthBrowser(app);
    expect(await finish(attacker, "github", params.state)).toBe(
      `${CALLBACKS.errorCallbackURL}?error=state_mismatch`,
    );
    expect(fake.requestsTo("POST", "/github/token")).toHaveLength(0);

    // The legitimate browser completes the flow; the state is then spent.
    const stateCookie = starter.jar.get("better-auth.state") ?? "";
    await finish(starter, "github", params.state);
    starter.jar.set("better-auth.state", stateCookie);
    expect(await finish(starter, "github", params.state)).toBe(
      `${API}/api/auth/error?error=state_mismatch`,
    );
  });

  it("redirects provider errors and malformed callbacks to the error page", async () => {
    const browser = oauthBrowser(app);
    const { params } = await startSignIn(browser);
    const denied = await browser.call(
      `/api/auth/callback/github?error=access_denied&error_description=User%20cancelled&state=${params.state}`,
    );
    expect(denied.status).toBe(302);
    expect(denied.headers.get("location")).toBe(
      `${CALLBACKS.errorCallbackURL}?error=access_denied&error_description=User+cancelled`,
    );

    const noState = await browser.call("/api/auth/callback/github?code=x");
    expect(noState.headers.get("location")).toBe(
      `${API}/api/auth/error?error=state_not_found`,
    );

    const malformed = await browser.call(
      "/api/auth/callback/github?code=a&code=b&state=s",
    );
    expect(malformed.headers.get("location")).toBe(
      `${API}/api/auth/error?error=invalid_callback_request`,
    );
  });

  it("redirects with invalid_code when the provider refuses the code", async () => {
    fake.reply("POST", "/github/token", { error: "bad_verification_code" });
    const browser = oauthBrowser(app);
    const { params } = await startSignIn(browser);
    expect(await finish(browser, "github", params.state)).toBe(
      `${CALLBACKS.errorCallbackURL}?error=invalid_code`,
    );
  });

  it("refuses untrusted redirect targets and unknown providers", async () => {
    const browser = oauthBrowser(app);
    const evil = await browser.post("/api/auth/sign-in/social", {
      provider: "github",
      callbackURL: "https://evil.example.com/steal",
    });
    expect(evil.status).toBe(403);
    expect(await readErrorBody(evil)).toMatchObject({
      code: "INVALID_CALLBACK_URL",
      message: "Invalid callbackURL",
    });

    const evilError = await browser.post("/api/auth/sign-in/social", {
      provider: "github",
      errorCallbackURL: "//evil.example.com",
    });
    expect(evilError.status).toBe(403);
    expect((await readErrorBody(evilError)).code).toBe(
      "INVALID_ERROR_CALLBACK_URL",
    );

    const unknown = await browser.post("/api/auth/sign-in/social", {
      provider: "myspace",
      callbackURL: "/dashboard",
    });
    expect(unknown.status).toBe(404);
    expect(await readErrorBody(unknown)).toMatchObject({
      code: "PROVIDER_NOT_FOUND",
      message: "Provider not found",
    });
    expect(await app.db.count(VerificationEntity)).toBe(0);
  });

  it("enforces DISABLE_REGISTRATION, letting in only verified invitees", async () => {
    const owner = await createWorkspaceMember(app.db);
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    githubUser();

    const refused = oauthBrowser(app);
    const first = await startSignIn(refused);
    expect(await finish(refused, "github", first.params.state)).toBe(
      `${CALLBACKS.errorCallbackURL}?error=Registration_is_currently_disabled._You_need_a_valid_invitation_to_create_an_account.`,
    );
    expect(await app.db.count(UserEntity)).toBe(1);

    await createInvitation(app.db, {
      workspaceId: owner.workspace.id,
      inviterId: owner.user.id,
      email: "octo@example.com",
    });
    const invited = oauthBrowser(app);
    const second = await startSignIn(invited);
    expect(await finish(invited, "github", second.params.state)).toBe(
      CALLBACKS.newUserCallbackURL,
    );
    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "octo@example.com",
    });
    expect(user.role).toBe("user");
  });

  it("does not sign a banned user in", async () => {
    const user = await createUser(app.db, {
      email: "octo@example.com",
      banned: true,
    });
    await insertRow(app.db, AccountEntity, {
      id: "acc-banned",
      accountId: "4242",
      providerId: "github",
      userId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    githubUser();
    const browser = oauthBrowser(app);
    const { params } = await startSignIn(browser);
    const location = new URL(await finish(browser, "github", params.state));
    expect(location.searchParams.get("error")).toBe("BANNED_USER");
    expect(location.searchParams.get("error_description")).toContain(
      "You have been banned",
    );
    expect(browser.jar.get("kaneo.access_token")).toBeUndefined();
  });

  it("signs in with Google from the ID token's claims", async () => {
    fake.reply("POST", "/google/token", {
      access_token: "google-access",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "email profile openid",
      id_token: fakeIdToken({
        sub: "google-sub",
        email: "ada@example.com",
        email_verified: true,
        name: "Ada Lovelace",
        picture: "https://example.com/ada.png",
      }),
    });
    const browser = oauthBrowser(app);
    const { params } = await startSignIn(browser, {
      provider: "google",
      ...CALLBACKS,
    });
    expect(params.scope).toBe("email profile openid");
    expect(params.codeChallenge).toBeTruthy();
    expect(await finish(browser, "google", params.state)).toBe(
      CALLBACKS.newUserCallbackURL,
    );
    const account = await app.db.findOneByOrFail(AccountEntity, {
      providerId: "google",
    });
    expect(account.accountId).toBe("google-sub");
    expect(account.accessTokenExpiresAt).toBeInstanceOf(Date);
    expect(account.scope).toBe("email,profile,openid");
    expect(browser.jar.get("better-auth.last_used_login_method")).toBe("google");
  });

  it("signs in with Discord, whose authorization URL has no PKCE", async () => {
    fake.reply("POST", "/discord/token", {
      access_token: "discord-access",
      token_type: "Bearer",
      scope: "identify email",
    });
    fake.reply("GET", "/discord/users/@me", {
      id: "80351110224678912",
      username: "nelly",
      global_name: "Nelly",
      discriminator: "0",
      avatar: null,
      email: "nelly@example.com",
      verified: true,
    });
    const browser = oauthBrowser(app);
    const { json, params } = await startSignIn(browser, {
      provider: "discord",
      ...CALLBACKS,
    });
    expect(params.codeChallenge).toBeNull();
    expect(json.url).toContain("scope=identify+email");
    expect(json.url).toContain("prompt=none");
    expect(await finish(browser, "discord", params.state)).toBe(
      CALLBACKS.newUserCallbackURL,
    );
    const [tokenRequest] = fake.requestsTo("POST", "/discord/token");
    expect(tokenRequest?.body.code_verifier).toBeUndefined();
    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "nelly@example.com",
    });
    expect(user.name).toBe("Nelly");
    expect(user.image).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/\d\.png$/);
  });

  it("answers without a Location header when the client handles the redirect", async () => {
    const browser = oauthBrowser(app);
    const response = await browser.post("/api/auth/sign-in/social", {
      provider: "github",
      callbackURL: "/dashboard",
      disableRedirect: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(((await response.json()) as { redirect: boolean }).redirect).toBe(false);
  });

  it("requires the CAPTCHA to start a sign-in, but not at the callback", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-secret");
    const browser = oauthBrowser(app);
    for (const [path, body] of [
      ["/api/auth/sign-in/social", { provider: "github", callbackURL: "/dashboard" }],
      ["/api/auth/sign-in/oauth2", { providerId: "custom", callbackURL: "/dashboard" }],
    ] as const) {
      const response = await browser.post(path, body);
      expect(response.status).toBe(403);
      expect((await readErrorBody(response)).code).toBe("CAPTCHA_FAILED");
    }
    expect(await app.db.count(VerificationEntity)).toBe(0);

    const callback = await browser.call(
      "/api/auth/callback/github?code=invalid&state=invalid",
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      `${API}/api/auth/error?error=state_mismatch`,
    );
  });

  it("shows the default error page, or sends production browsers to the site root", async () => {
    const page = await app.request(
      "/api/auth/error?error=state_mismatch&error_description=%3Cscript%3E",
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("state_mismatch");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");

    vi.stubEnv("NODE_ENV", "production");
    const redirected = await app.request("/api/auth/error?error=bad%20code", {
      redirect: "manual",
    });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe("/?error=UNKNOWN");
  });

  it("moves a form_post callback onto the GET callback", async () => {
    const response = await app.request(
      "/api/auth/callback/github?state=abc",
      { method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "xyz" }) },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${API}/api/auth/callback/github?code=xyz&state=abc`,
    );
  });
});
