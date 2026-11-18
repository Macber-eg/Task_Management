import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceCodeEntity } from "../../src/database/entities/device-code.entity";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { addWorkspaceMember } from "../support/fixtures/add-workspace-member";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspace } from "../support/fixtures/create-workspace";
import { type OAuthBrowser, oauthBrowser } from "../support/fixtures/oauth-browser";
import { seedApiKey } from "../support/fixtures/seed-api-key";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const WEB = "http://localhost:5173";

type CodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
};

describe("API integration: device authorization (RFC 8628)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    vi.stubEnv("KANEO_CLIENT_URL", WEB);
    vi.stubEnv("DEVICE_AUTH_CLIENT_IDS", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function postJson(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  async function requestCode(clientId = "kaneo-cli"): Promise<CodeResponse> {
    const response = await postJson("/api/auth/device/code", {
      client_id: clientId,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return (await response.json()) as CodeResponse;
  }

  function poll(deviceCode: string, clientId = "kaneo-cli") {
    return postJson("/api/auth/device/token", {
      grant_type: GRANT,
      device_code: deviceCode,
      client_id: clientId,
    });
  }

  async function signedIn(email: string): Promise<OAuthBrowser> {
    const browser = oauthBrowser(app);
    const response = await browser.post("/api/auth/sign-up/email", {
      name: "Device user",
      email,
      password: "device-flow-password-12345",
    });
    expect(response.status).toBe(200);
    return browser;
  }

  /** Lets the next poll through the five-second polling interval. */
  async function allowPoll(deviceCode: string) {
    await app.db.update(
      DeviceCodeEntity,
      { deviceCode },
      { lastPolledAt: new Date(Date.now() - 60_000) },
    );
  }

  async function approve(browser: OAuthBrowser, userCode: string) {
    const claim = await browser.call(
      `/api/auth/device?user_code=${encodeURIComponent(userCode)}`,
    );
    expect(claim.status).toBe(200);
    expect(await claim.json()).toEqual({ user_code: userCode, status: "pending" });
    const approved = await browser.post("/api/auth/device/approve", { userCode });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ success: true });
  }

  it("returns device and user codes for an allowed client_id", async () => {
    const body = await requestCode();
    expect(body.device_code).toMatch(/^[A-Za-z0-9]{40}$/);
    expect(body.user_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.verification_uri).toBe(`${WEB}/device`);
    expect(body.verification_uri_complete).toBe(
      `${WEB}/device?user_code=${body.user_code}`,
    );
    expect(body).toMatchObject({ interval: 5, expires_in: 1800 });

    const row = await app.db.findOneByOrFail(DeviceCodeEntity, {
      deviceCode: body.device_code,
    });
    expect(row).toMatchObject({
      status: "pending",
      clientId: "kaneo-cli",
      userId: null,
      pollingInterval: 5000,
    });
  });

  it("rejects disallowed client_id, honoring DEVICE_AUTH_CLIENT_IDS", async () => {
    const res = await postJson("/api/auth/device/code", {
      client_id: "unknown-client",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_client",
      error_description: "Invalid client ID",
    });

    vi.stubEnv("DEVICE_AUTH_CLIENT_IDS", "my-cli, other");
    expect(
      (await postJson("/api/auth/device/code", { client_id: "kaneo-cli" }))
        .status,
    ).toBe(400);
    await requestCode("my-cli");
  });

  it("returns authorization_pending before approval, then slow_down when polled too fast", async () => {
    const { device_code } = await requestCode();
    const pending = await poll(device_code);
    expect(pending.status).toBe(400);
    expect(await pending.json()).toEqual({
      error: "authorization_pending",
      error_description: "Authorization pending",
    });

    const tooFast = await poll(device_code);
    expect(tooFast.status).toBe(400);
    expect(((await tooFast.json()) as { error: string }).error).toBe("slow_down");
  });

  it("issues a long-lived opaque token after approval that works as a Bearer credential", async () => {
    const browser = await signedIn("device@example.com");
    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "device@example.com",
    });
    const workspace = await createWorkspace(app.db);
    await addWorkspaceMember(app.db, workspace.id, user.id, "owner");

    const code = await requestCode();
    await approve(browser, code.user_code);

    const tokenRes = await poll(code.device_code);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
    expect(tokenRes.headers.get("pragma")).toBe("no-cache");
    const token = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    };
    expect(token.token_type).toBe("Bearer");
    expect(token.scope).toBe("");
    expect(token.expires_in).toBeGreaterThan(7 * 24 * 3600 - 60);

    // Spent: the code is gone and only the token's hash is stored.
    expect(await app.db.count(DeviceCodeEntity)).toBe(0);
    const session = await app.db.findOneByOrFail(SessionEntity, {
      kind: "device",
    });
    expect(session.userId).toBe(user.id);
    expect(session.token).toBe(
      createHash("sha256").update(token.access_token).digest("base64url"),
    );
    expect((await poll(code.device_code)).status).toBe(400);

    const bearer = { Authorization: `Bearer ${token.access_token}` };
    const sessionRes = await app.request("/api/auth/get-session", {
      headers: bearer,
    });
    expect(sessionRes.status).toBe(200);
    expect(
      ((await sessionRes.json()) as { user: { id: string } }).user.id,
    ).toBe(user.id);

    const organizations = await app.request("/api/auth/organization/list", {
      headers: bearer,
    });
    expect(organizations.status).toBe(200);
    expect(await organizations.json()).toEqual([
      expect.objectContaining({ id: workspace.id }),
    ]);
  });

  it("slides the token's expiry when it is used after a day", async () => {
    const browser = await signedIn("slide@example.com");
    const code = await requestCode();
    await approve(browser, code.user_code);
    const { access_token } = (await (await poll(code.device_code)).json()) as {
      access_token: string;
    };

    const nearlyExpired = new Date(Date.now() + 60 * 60 * 1000);
    await app.db.update(SessionEntity, { kind: "device" }, {
      expiresAt: nearlyExpired,
    });
    const res = await app.request("/api/auth/get-session", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status).toBe(200);
    const session = await app.db.findOneByOrFail(SessionEntity, {
      kind: "device",
    });
    expect(session.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 60 * 60 * 1000,
    );

    await app.db.update(SessionEntity, { kind: "device" }, {
      expiresAt: new Date(Date.now() - 1000),
    });
    const expired = await app.request("/api/auth/get-session", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(expired.status).toBe(401);
  });

  it("answers access_denied once the person denies, and forgets the code", async () => {
    const browser = await signedIn("deny@example.com");
    const code = await requestCode();
    await browser.call(`/api/auth/device?user_code=${code.user_code}`);
    const denied = await browser.post("/api/auth/device/deny", {
      userCode: code.user_code,
    });
    expect(denied.status).toBe(200);

    const res = await poll(code.device_code);
    expect(await res.json()).toEqual({
      error: "access_denied",
      error_description: "Access denied",
    });
    expect(await app.db.count(DeviceCodeEntity)).toBe(0);
  });

  it("only lets the person who claimed a code approve it", async () => {
    const claimant = await signedIn("claimant@example.com");
    const other = await signedIn("other@example.com");
    const code = await requestCode();

    const unclaimed = await claimant.post("/api/auth/device/approve", {
      userCode: code.user_code,
    });
    expect(unclaimed.status).toBe(400);
    expect(((await unclaimed.json()) as { error: string }).error).toBe(
      "invalid_request",
    );

    // Codes may be typed with the dash the web app shows.
    const dashed = `${code.user_code.slice(0, 4)}-${code.user_code.slice(4)}`;
    await claimant.call(`/api/auth/device?user_code=${dashed}`);
    // A second viewer does not take the claim over.
    await other.call(`/api/auth/device?user_code=${code.user_code}`);

    const forbidden = await other.post("/api/auth/device/approve", {
      userCode: code.user_code,
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "access_denied",
      error_description:
        "You are not authorized to approve this device authorization",
    });

    const anonymous = await postJson("/api/auth/device/approve", {
      userCode: code.user_code,
    });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({
      error: "unauthorized",
      error_description: "Authentication required",
    });

    const unknown = await claimant.post("/api/auth/device/approve", {
      userCode: "NOPE2345",
    });
    expect(await unknown.json()).toEqual({
      error: "invalid_request",
      error_description: "Invalid user code",
    });
  });

  it("reports expired codes to the polling client and to the browser", async () => {
    const browser = await signedIn("late@example.com");
    const code = await requestCode();
    await app.db.update(
      DeviceCodeEntity,
      { deviceCode: code.device_code },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const view = await browser.call(`/api/auth/device?user_code=${code.user_code}`);
    expect(await view.json()).toEqual({
      error: "expired_token",
      error_description: "User code has expired",
    });
    await allowPoll(code.device_code);
    const res = await poll(code.device_code);
    expect(await res.json()).toEqual({
      error: "expired_token",
      error_description: "Device code has expired",
    });
    expect(await app.db.count(DeviceCodeEntity)).toBe(0);
  });

  it("rejects a poll from another client and an unknown device code", async () => {
    vi.stubEnv("DEVICE_AUTH_CLIENT_IDS", "kaneo-cli,kaneo-mcp");
    const code = await requestCode();
    expect(await (await poll(code.device_code, "kaneo-mcp")).json()).toEqual({
      error: "invalid_grant",
      error_description: "Client ID mismatch",
    });
    expect(await (await poll("does-not-exist")).json()).toEqual({
      error: "invalid_grant",
      error_description: "Invalid device code",
    });
    const badGrant = await postJson("/api/auth/device/token", {
      grant_type: "password",
      device_code: code.device_code,
      client_id: "kaneo-cli",
    });
    expect(badGrant.status).toBe(400);
    expect((await readErrorBody(badGrant)).code).toBe("VALIDATION_ERROR");
  });

  it("refuses a token for a banned user", async () => {
    const browser = await signedIn("banned@example.com");
    const code = await requestCode();
    await approve(browser, code.user_code);
    await app.db.update(UserEntity, { email: "banned@example.com" }, {
      banned: true,
    });
    const res = await poll(code.device_code);
    expect(res.status).toBe(403);
    expect((await readErrorBody(res)).code).toBe("BANNED_USER");
  });

  it("redirects a browser opening the device URL to the web app", async () => {
    const navigation = await app.request("/api/auth/device?user_code=ABCD2345", {
      headers: { "Sec-Fetch-Dest": "document" },
      redirect: "manual",
    });
    expect(navigation.status).toBe(302);
    expect(navigation.headers.get("location")).toBe(
      `${WEB}/device?user_code=ABCD2345`,
    );

    const forced = await app.request("/api/auth/device?ui=1", {
      redirect: "manual",
    });
    expect(forced.headers.get("location")).toBe(`${WEB}/device`);

    const missing = await app.request("/api/auth/device");
    expect(missing.status).toBe(400);
    expect((await readErrorBody(missing)).code).toBe("VALIDATION_ERROR");
  });

  it("does not let an API key approve a device", async () => {
    const user = await createUser(app.db);
    const { key } = await seedApiKey(app.db, user.id);
    const code = await requestCode();
    await app.request(`/api/auth/device?user_code=${code.user_code}`, {
      headers: { "x-api-key": key },
    });
    const row = await app.db.findOneByOrFail(DeviceCodeEntity, {
      deviceCode: code.device_code,
    });
    expect(row.userId).toBeNull();
  });

  it("still authenticates with a valid API key Bearer", async () => {
    const user = await createUser(app.db);
    const { key } = await seedApiKey(app.db, user.id);
    const res = await app.request("/api/auth/get-session", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects an invalid Bearer token even when a valid session cookie is present", async () => {
    const browser = await signedIn("bearer@example.com");
    for (const scheme of ["Bearer", "bearer"]) {
      const res = await browser.call("/api/oauth/id-token", {
        headers: { authorization: `${scheme} definitely-not-a-real-token` },
      });
      expect(res.status).toBe(401);
    }
  });
});
