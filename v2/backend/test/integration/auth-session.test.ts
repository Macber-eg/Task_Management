import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccountEntity } from "../../src/database/entities/account.entity";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { CookieJar } from "../support/cookie-jar";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { insertRow } from "../support/fixtures/insert-row";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const ACCESS = "kaneo.access_token";
const REFRESH = "kaneo.refresh_token";
const LEGACY = "better-auth.session_token";
const PASSWORD = "correct horse battery";

type SessionBody = {
  session: { id: string; userId: string; token: string; activeOrganizationId: string | null };
  user: { id: string; email: string; role: string | null };
} | null;

describe("API integration: sessions and email sign-in", () => {
  let app: TestApp;

  /** A browser: carries its cookies and keeps what responses set. */
  function browser() {
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
    return { jar, call, post };
  }

  async function signUp(email = "ada@example.com") {
    const client = browser();
    const response = await client.post("/api/auth/sign-up/email", {
      name: "Ada",
      email,
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    return client;
  }

  async function currentSession(client: ReturnType<typeof browser>) {
    const response = await client.call("/api/auth/get-session");
    expect(response.status).toBe(200);
    return (await response.json()) as SessionBody;
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it("signs up, stores a bcrypt credential and promotes the first user", async () => {
    const client = await signUp("Ada@Example.com");

    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "ada@example.com",
    });
    expect(user.role).toBe("admin");
    const account = await app.db.findOneByOrFail(AccountEntity, {
      userId: user.id,
    });
    expect(account.providerId).toBe("credential");
    expect(account.accountId).toBe(user.id);
    expect(account.password).toMatch(/^\$2[aby]\$10\$/);

    expect(client.jar.names().sort()).toEqual([ACCESS, REFRESH]);
    const session = await currentSession(client);
    expect(session?.user).toMatchObject({ id: user.id, role: "admin" });
    expect(session?.session.token).toBe(client.jar.get(ACCESS));

    const second = await signUp("grace@example.com");
    expect((await currentSession(second))?.user.role).not.toBe("admin");
  });

  it("stores only a hash of the refresh token", async () => {
    const client = await signUp();
    const [sessionId, secret] = (client.jar.get(REFRESH) ?? "").split(".");
    const row = await app.db.findOneByOrFail(SessionEntity, { id: sessionId });
    expect(row.token).not.toContain(secret);
    expect(row.kind).toBe("browser");
    expect(row.rotatedAt).toBeInstanceOf(Date);
  });

  it("rejects a duplicate address, a short password and a wrong password", async () => {
    await signUp();
    const client = browser();

    const duplicate = await client.post("/api/auth/sign-up/email", {
      name: "Ada",
      email: "ADA@example.com",
      password: PASSWORD,
    });
    expect(duplicate.status).toBe(422);
    expect((await readErrorBody(duplicate)).code).toBe(
      "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    );

    const short = await client.post("/api/auth/sign-up/email", {
      name: "Bo",
      email: "bo@example.com",
      password: "short",
    });
    expect(short.status).toBe(400);
    expect((await readErrorBody(short)).code).toBe("PASSWORD_TOO_SHORT");

    for (const body of [
      { email: "ada@example.com", password: "not the password" },
      { email: "nobody@example.com", password: PASSWORD },
    ]) {
      const wrong = await client.post("/api/auth/sign-in/email", body);
      expect(wrong.status).toBe(401);
      expect(await readErrorBody(wrong)).toMatchObject({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      });
    }
    expect(client.jar.names()).toEqual([]);
  });

  it("signs in and starts in the user's first workspace", async () => {
    const { user, workspace } = await createWorkspaceMember(app.db);
    const bcrypt = await import("bcryptjs");
    await insertRow(app.db, AccountEntity, {
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await bcrypt.default.hash(PASSWORD, 10),
    });

    const client = browser();
    const response = await client.post("/api/auth/sign-in/email", {
      email: user.email.toUpperCase(),
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { redirect: boolean; token: string };
    expect(body.redirect).toBe(false);
    expect(body.token).toBe(client.jar.get(ACCESS));

    const session = await currentSession(client);
    expect(session?.session.activeOrganizationId).toBe(workspace.id);

    // The access cookie authenticates ordinary API routes.
    const labels = await client.call(`/api/label/workspace/${workspace.id}`);
    expect(labels.status).toBe(200);
  });

  it("accepts the access token as a Bearer credential", async () => {
    const client = await signUp();
    const response = await app.request("/api/auth/list-accounts", {
      headers: { authorization: `Bearer ${client.jar.get(ACCESS)}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({ providerId: "credential", scopes: [] }),
    ]);
  });

  it("answers null without credentials and 401 on protected routes", async () => {
    const anonymous = browser();
    expect(await currentSession(anonymous)).toBeNull();

    const response = await anonymous.call("/api/auth/list-accounts");
    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toEqual({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("renews from the refresh cookie when the access token is gone", async () => {
    const client = await signUp();
    const firstRefresh = client.jar.get(REFRESH);
    client.jar.delete(ACCESS);

    // The refresh cookie is scoped to the auth endpoints only.
    expect(client.jar.header("/api/label/x")).toBe("");

    const session = await currentSession(client);
    expect(session?.user.email).toBe("ada@example.com");
    expect(client.jar.get(ACCESS)).toBeTruthy();
    expect(client.jar.get(REFRESH)).not.toBe(firstRefresh);

    client.jar.delete(ACCESS);
    const withoutRefresh = await client.call(
      "/api/auth/get-session?disableRefresh=true",
    );
    expect(await withoutRefresh.json()).toBeNull();
  });

  it("rotates on refresh and tolerates a concurrent tab briefly", async () => {
    const client = await signUp();
    const original = client.jar.get(REFRESH) ?? "";
    const sessionId = original.split(".")[0] ?? "";

    const first = await client.post("/api/auth/refresh");
    expect(first.status).toBe(200);
    const rotated = client.jar.get(REFRESH);
    expect(rotated).not.toBe(original);

    // A second tab still holding the replaced token gets an access token,
    // but no new refresh token.
    const tab = browser();
    tab.jar.set(REFRESH, original, "/api/auth");
    const raced = await tab.post("/api/auth/refresh");
    expect(raced.status).toBe(200);
    expect(tab.jar.get(REFRESH)).toBe(original);
    expect(tab.jar.get(ACCESS)).toBeTruthy();

    // Replayed after the grace window, the same token ends the session.
    await app.db.update(
      SessionEntity,
      { id: sessionId },
      { rotatedAt: new Date(Date.now() - 60_000) },
    );
    const replayed = await tab.post("/api/auth/refresh");
    expect(replayed.status).toBe(401);
    expect((await readErrorBody(replayed)).code).toBe("SESSION_EXPIRED");
    expect(await app.db.findOneBy(SessionEntity, { id: sessionId })).toBeNull();

    const afterTheft = await client.call("/api/auth/list-accounts");
    expect(afterTheft.status).toBe(401);
  });

  it("revokes at once on sign-out, even for a still-valid access token", async () => {
    const client = await signUp();
    const accessToken = client.jar.get(ACCESS);

    const response = await client.post("/api/auth/sign-out");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(client.jar.names()).toEqual([]);
    expect(await app.db.count(SessionEntity)).toBe(0);

    const replay = await app.request("/api/auth/list-accounts", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(replay.status).toBe(401);
  });

  it("rejects a banned user's existing session", async () => {
    const client = await signUp();
    await app.db.update(UserEntity, { email: "ada@example.com" }, { banned: true });

    expect((await client.call("/api/auth/list-accounts")).status).toBe(401);
    expect(await currentSession(client)).toBeNull();
  });

  it("upgrades a login from the previous backend without a new sign-in", async () => {
    const user = await createUser(app.db);
    const legacyToken = "legacyTokenLegacyTokenLegacyToken";
    await insertRow(app.db, SessionEntity, {
      id: "legacy-session",
      token: legacyToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const signature = createHmac("sha256", process.env.AUTH_SECRET ?? "")
      .update(legacyToken)
      .digest("base64");

    const client = browser();
    client.jar.set(LEGACY, encodeURIComponent(`${legacyToken}.${signature}`));

    // The old cookie alone still authenticates ordinary routes.
    expect((await client.call("/api/auth/list-accounts")).status).toBe(200);

    const session = await currentSession(client);
    expect(session?.session.id).toBe("legacy-session");
    expect(client.jar.names().sort()).toEqual([ACCESS, REFRESH]);

    const row = await app.db.findOneByOrFail(SessionEntity, {
      id: "legacy-session",
    });
    expect(row.token).not.toBe(legacyToken);
    expect(row.rotatedAt).toBeInstanceOf(Date);

    // A forged signature is worth nothing.
    const forged = browser();
    forged.jar.set(LEGACY, encodeURIComponent(`${legacyToken}.AAAA`));
    expect(await currentSession(forged)).toBeNull();
  });

  it("changes the password and can end the other sessions", async () => {
    const first = await signUp();
    const second = browser();
    await second.post("/api/auth/sign-in/email", {
      email: "ada@example.com",
      password: PASSWORD,
    });
    expect(await app.db.count(SessionEntity)).toBe(2);

    const wrong = await first.post("/api/auth/change-password", {
      currentPassword: "nope nope nope",
      newPassword: "a brand new password",
    });
    expect(wrong.status).toBe(400);
    expect((await readErrorBody(wrong)).code).toBe("INVALID_PASSWORD");

    const changed = await first.post("/api/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: "a brand new password",
      revokeOtherSessions: true,
    });
    expect(changed.status).toBe(200);
    expect(await app.db.count(SessionEntity)).toBe(1);
    expect((await second.call("/api/auth/list-accounts")).status).toBe(401);
    expect((await first.call("/api/auth/list-accounts")).status).toBe(200);

    const relogin = await browser().post("/api/auth/sign-in/email", {
      email: "ada@example.com",
      password: "a brand new password",
    });
    expect(relogin.status).toBe(200);
  });

  it("updates the profile but never the email", async () => {
    const client = await signUp();

    const updated = await client.post("/api/auth/update-user", {
      name: "Ada Lovelace",
      locale: "de",
    });
    expect(await updated.json()).toEqual({ status: true });
    const user = await app.db.findOneByOrFail(UserEntity, {
      email: "ada@example.com",
    });
    expect(user).toMatchObject({ name: "Ada Lovelace", locale: "de" });

    const email = await client.post("/api/auth/update-user", {
      email: "other@example.com",
    });
    expect(email.status).toBe(400);
    expect((await readErrorBody(email)).code).toBe("EMAIL_CAN_NOT_BE_UPDATED");
  });

  it("refuses cookie-authenticated writes from an untrusted origin", async () => {
    const client = await signUp();
    const previous = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = "https://app.example.com";
    try {
      const foreign = await client.call("/api/auth/update-user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ name: "Mallory" }),
      });
      expect(foreign.status).toBe(403);
      expect((await readErrorBody(foreign)).code).toBe("INVALID_ORIGIN");

      const trusted = await client.call("/api/auth/update-user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example.com",
        },
        body: JSON.stringify({ name: "Ada" }),
      });
      expect(trusted.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = previous;
    }
  });
});
