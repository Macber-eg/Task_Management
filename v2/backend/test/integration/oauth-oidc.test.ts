import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { createUser } from "../support/fixtures/create-user";
import {
  authorizationParams,
  type OAuthBrowser,
  oauthBrowser,
} from "../support/fixtures/oauth-browser";
import { FakeOAuthProvider, fakeIdToken } from "../support/fixtures/oauth-fake-provider";
import { seedApiKey } from "../support/fixtures/seed-api-key";
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
const REDIRECT_URI = `${API}/api/auth/oauth2/callback/custom`;

describe("API integration: generic OIDC sign-in", () => {
  const fake = new FakeOAuthProvider();
  let app: TestApp;

  beforeAll(async () => {
    await fake.start();
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
    await fake.stop();
  });

  function discovery() {
    fake.reply("GET", "/.well-known/openid-configuration", {
      issuer: fake.baseUrl,
      authorization_endpoint: fake.url("/authorize"),
      token_endpoint: fake.url("/token"),
      userinfo_endpoint: fake.url("/userinfo"),
    });
  }

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    fake.reset();
    discovery();
    fake.reply("POST", "/token", {
      access_token: "oidc-access",
      token_type: "Bearer",
      expires_in: 300,
      scope: "openid profile email",
    });
    fake.reply("GET", "/userinfo", {
      sub: "kc-user-1",
      email: "Jane@Example.com",
      email_verified: true,
      preferred_username: "jdoe",
    });
    vi.stubEnv("KANEO_API_URL", API);
    vi.stubEnv("KANEO_CLIENT_URL", WEB);
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_ID", "kaneo");
    vi.stubEnv("CUSTOM_OAUTH_CLIENT_SECRET", "kaneo-secret");
    vi.stubEnv(
      "CUSTOM_OAUTH_DISCOVERY_URL",
      fake.url("/.well-known/openid-configuration"),
    );
    vi.stubEnv("CUSTOM_OAUTH_AUTHORIZATION_URL", "");
    vi.stubEnv("CUSTOM_OAUTH_TOKEN_URL", "");
    vi.stubEnv("CUSTOM_OAUTH_USER_INFO_URL", "");
    vi.stubEnv("CUSTOM_OAUTH_SCOPES", "openid,profile,email");
    vi.stubEnv("CUSTOM_AUTH_PKCE", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function start(browser: OAuthBrowser, body: Record<string, unknown> = {}) {
    const response = await browser.post("/api/auth/sign-in/oauth2", {
      providerId: "custom",
      ...CALLBACKS,
      ...body,
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { url: string; redirect: boolean };
    return { json, params: authorizationParams(json.url) };
  }

  async function finish(browser: OAuthBrowser, query: string) {
    const response = await browser.call(
      `/api/auth/oauth2/callback/custom?${query}`,
    );
    expect(response.status).toBe(302);
    return response.headers.get("location") ?? "";
  }

  it("signs a new user in through discovery, PKCE and the userinfo endpoint", async () => {
    const browser = oauthBrowser(app);
    const { json, params } = await start(browser);

    expect(json.redirect).toBe(true);
    expect(json.url.startsWith(fake.url("/authorize"))).toBe(true);
    expect(params.redirectUri).toBe(REDIRECT_URI);
    expect(params.clientId).toBe("kaneo");
    expect(params.scope).toBe("openid profile email");
    expect(params.codeChallenge).toBeTruthy();
    expect(new URL(json.url).searchParams.get("response_type")).toBe("code");

    expect(
      await finish(browser, `code=oidc-code&state=${params.state}&iss=${encodeURIComponent(fake.baseUrl)}`),
    ).toBe(CALLBACKS.newUserCallbackURL);

    const [tokenRequest] = fake.requestsTo("POST", "/token");
    expect(tokenRequest?.body).toMatchObject({
      grant_type: "authorization_code",
      code: "oidc-code",
      redirect_uri: REDIRECT_URI,
      client_id: "kaneo",
      client_secret: "kaneo-secret",
    });
    expect(tokenRequest?.body.code_verifier).toHaveLength(128);
    const [userInfoRequest] = fake.requestsTo("GET", "/userinfo");
    expect(userInfoRequest?.headers.authorization).toBe("Bearer oidc-access");

    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "jane@example.com",
    });
    expect(user).toMatchObject({ name: "jdoe", emailVerified: true, role: "admin" });
    const account = await app.db.findOneByOrFail(AccountEntity, {
      userId: user.id,
    });
    expect(account).toMatchObject({
      providerId: "custom",
      accountId: "kc-user-1",
      accessToken: "oidc-access",
      scope: "openid,profile,email",
    });
    expect(browser.jar.get("better-auth.last_used_login_method")).toBe("custom");
    expect(browser.jar.get("kaneo.access_token")).toBeTruthy();
  });

  it("reads the ID token's claims, stores the token and serves it from /oauth/id-token", async () => {
    const idToken = fakeIdToken({
      sub: "kc-user-2",
      email: "grace@example.com",
      email_verified: true,
      given_name: "Grace",
      family_name: "Hopper",
      locale: "de",
    });
    fake.reply("POST", "/token", {
      access_token: "oidc-access",
      token_type: "Bearer",
      id_token: idToken,
    });
    const browser = oauthBrowser(app);
    const { params } = await start(browser);
    await finish(browser, `code=c&state=${params.state}`);

    expect(fake.requestsTo("GET", "/userinfo")).toHaveLength(0);
    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "grace@example.com",
    });
    expect(user).toMatchObject({ name: "Grace Hopper", locale: "de" });

    const response = await browser.call("/api/oauth/id-token");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ idToken });
  });

  it("uses the manually configured URLs, and skips PKCE when it is turned off", async () => {
    vi.stubEnv("CUSTOM_OAUTH_DISCOVERY_URL", "");
    vi.stubEnv("CUSTOM_OAUTH_AUTHORIZATION_URL", fake.url("/authorize"));
    vi.stubEnv("CUSTOM_OAUTH_TOKEN_URL", fake.url("/token"));
    vi.stubEnv("CUSTOM_OAUTH_USER_INFO_URL", fake.url("/userinfo"));
    vi.stubEnv("CUSTOM_OAUTH_SCOPES", "");
    vi.stubEnv("CUSTOM_AUTH_PKCE", "false");
    vi.stubEnv("CUSTOM_OAUTH_RESPONSE_TYPE", "code");

    const browser = oauthBrowser(app);
    const { params } = await start(browser, { scopes: ["groups"] });
    expect(params.codeChallenge).toBeNull();
    expect(params.scope).toBe("groups");
    expect(await finish(browser, `code=c&state=${params.state}`)).toBe(
      CALLBACKS.newUserCallbackURL,
    );
    expect(fake.requestsTo("GET", "/.well-known/openid-configuration")).toHaveLength(0);
    const [tokenRequest] = fake.requestsTo("POST", "/token");
    expect(tokenRequest?.body.code_verifier).toBeUndefined();
  });

  it("redirects to the error page for issuer mismatches, missing claims and missing codes", async () => {
    const browser = oauthBrowser(app);
    const mismatch = await start(browser);
    expect(
      await finish(browser, `code=c&state=${mismatch.params.state}&iss=https://other.example.com`),
    ).toBe(`${CALLBACKS.errorCallbackURL}?error=issuer_mismatch`);

    fake.reply("GET", "/userinfo", { sub: "kc-user-3", name: "No Mail" });
    const noEmail = await start(browser);
    expect(await finish(browser, `code=c&state=${noEmail.params.state}`)).toBe(
      `${CALLBACKS.errorCallbackURL}?error=email_is_missing`,
    );

    fake.reply("POST", "/token", { error: "invalid_grant" }, 400);
    const refused = await start(browser);
    expect(await finish(browser, `code=c&state=${refused.params.state}`)).toBe(
      `${CALLBACKS.errorCallbackURL}?error=oauth_code_verification_failed`,
    );

    expect(await finish(browser, "state=whatever")).toBe(
      `${API}/api/auth/error?error=oAuth_code_missing`,
    );
    expect(
      await finish(browser, "error=access_denied&error_description=nope"),
    ).toBe(`${API}/api/auth/error?error=access_denied&error_description=nope`);
    expect(await app.db.count(UserEntity)).toBe(0);
  });

  it("does not link a local account the provider's email does not prove", async () => {
    await createUser(app.db, { email: "jane@example.com", emailVerified: true });
    fake.reply("GET", "/userinfo", {
      sub: "kc-user-1",
      email: "jane@example.com",
      email_verified: false,
      name: "Jane",
    });
    const browser = oauthBrowser(app);
    const { params } = await start(browser);
    expect(await finish(browser, `code=c&state=${params.state}`)).toBe(
      `${CALLBACKS.errorCallbackURL}?error=account_not_linked`,
    );
  });

  it("answers 400 for unknown providers and unusable configurations", async () => {
    const browser = oauthBrowser(app);
    const unknown = await browser.post("/api/auth/sign-in/oauth2", {
      providerId: "keycloak",
      callbackURL: "/dashboard",
    });
    expect(unknown.status).toBe(400);
    expect((await readErrorBody(unknown)).message).toBe(
      "No config found for provider keycloak",
    );

    vi.stubEnv("CUSTOM_OAUTH_DISCOVERY_URL", fake.url("/.well-known/missing"));
    const broken = await browser.post("/api/auth/sign-in/oauth2", {
      providerId: "custom",
      callbackURL: "/dashboard",
    });
    expect(broken.status).toBe(400);
    expect(await readErrorBody(broken)).toMatchObject({
      code: "INVALID_OAUTH_CONFIGURATION",
    });

    const callback = await browser.call(
      "/api/auth/oauth2/callback/keycloak?code=c&state=s",
    );
    expect(callback.status).toBe(400);
  });

  it("serves /oauth/id-token only to signed-in users", async () => {
    const anonymous = await app.request("/api/oauth/id-token");
    expect(anonymous.status).toBe(401);

    const user = await createUser(app.db);
    const { key } = await seedApiKey(app.db, user.id);
    const withKey = await app.request("/api/oauth/id-token", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(withKey.status).toBe(403);
    expect(await readErrorBody(withKey)).toEqual({
      message: "A user session is required",
      code: "SESSION_REQUIRED",
    });

    const browser = oauthBrowser(app);
    await browser.post("/api/auth/sign-up/email", {
      name: "Local",
      email: "local@example.com",
      password: "correct horse battery staple",
    });
    const response = await browser.call("/api/oauth/id-token");
    expect(await response.json()).toEqual({ idToken: null });
  });
});
