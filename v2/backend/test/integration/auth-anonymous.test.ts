import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SessionEntity } from "../../src/database/entities/session.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { createUser } from "../support/fixtures/create-user";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { openBrowser } from "../support/fixtures/email-browser";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const origin = "http://localhost:5173";
const LAST_LOGIN = "better-auth.last_used_login_method";
const FLAGS = [
  "DISABLE_REGISTRATION",
  "DISABLE_PASSWORD_REGISTRATION",
  "DISABLE_LOGIN_FORM",
  "DISABLE_GUEST_ACCESS",
] as const;

describe("guest sign-in", () => {
  let app: TestApp;

  const browser = () => openBrowser(app, { origin });
  const signInAsGuest = (tab = browser()) =>
    tab.post("/api/auth/sign-in/anonymous");

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    for (const flag of [...FLAGS, "TURNSTILE_SECRET_KEY"]) {
      vi.stubEnv(flag, undefined);
    }
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects anonymous bootstrap and ignores historical anonymous rows", async () => {
    const first = await signInAsGuest();
    expect(first.status).toBe(403);
    expect(await readErrorBody(first)).toMatchObject({
      code: "GUEST_ACCESS_DISABLED",
      message: "Guest access is unavailable on this instance.",
    });
    expect(await app.db.count(UserEntity)).toBe(0);

    await createUser(app.db, { id: "old-guest", isAnonymous: true });
    expect((await signInAsGuest()).status).toBe(403);
    expect(await app.db.count(UserEntity)).toBe(1);
  });

  it.each(FLAGS)("enforces %s on anonymous sign-in", async (flag) => {
    await createWorkspaceMember(app.db);
    vi.stubEnv(flag, "true");
    expect((await signInAsGuest()).status).toBe(403);
    expect(await app.db.count(UserEntity)).toBe(1);
  });

  it("creates a guest on an initialized open instance, never as administrator", async () => {
    await createWorkspaceMember(app.db);
    const tab = browser();
    const response = await signInAsGuest(tab);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      user: { id: string; email: string; name: string; isAnonymous: boolean };
    };
    expect(body.token).toMatch(/^eyJ/);
    expect(body.user.isAnonymous).toBe(true);
    expect(body.user.email).toMatch(/^temp-[A-Za-z0-9]{32}@kaneo\.app$/);
    expect(body.user.name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(tab.jar.get(LAST_LOGIN)).toBeUndefined();
    expect(
      await app.db.findOneByOrFail(UserEntity, { id: body.user.id }),
    ).toMatchObject({ isAnonymous: true, emailVerified: false, role: "user" });
    expect(await app.db.countBy(UserEntity, { role: "admin" })).toBe(0);

    const again = await signInAsGuest(tab);
    expect(again.status).toBe(400);
    expect((await readErrorBody(again)).code).toBe(
      "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY",
    );
  });

  it("deletes the guest account once the browser signs up for real", async () => {
    await createWorkspaceMember(app.db);
    const tab = browser();
    const guest = (await (await signInAsGuest(tab)).json()) as {
      user: { id: string };
    };

    const signUp = await tab.post("/api/auth/sign-up/email", {
      name: "Real person",
      email: "real@example.com",
      password: "correct horse battery",
    });
    expect(signUp.status).toBe(200);
    const { user } = (await signUp.json()) as { user: { id: string } };

    expect(await app.db.findOneBy(UserEntity, { id: guest.user.id })).toBeNull();
    expect(await app.db.countBy(SessionEntity, { userId: guest.user.id })).toBe(0);
    expect(tab.jar.get(LAST_LOGIN)).toBe("email");
    const me = await tab.get("/api/auth/get-session");
    expect(((await me.json()) as { user: { id: string } }).user.id).toBe(
      user.id,
    );
  });

  it("keeps the guest account when guest access is off", async () => {
    await createWorkspaceMember(app.db);
    const tab = browser();
    const guest = (await (await signInAsGuest(tab)).json()) as {
      user: { id: string };
    };
    vi.stubEnv("DISABLE_GUEST_ACCESS", "true");

    expect(
      (
        await tab.post("/api/auth/sign-up/email", {
          name: "Real person",
          email: "real@example.com",
          password: "correct horse battery",
        })
      ).status,
    ).toBe(200);
    expect(
      await app.db.findOneBy(UserEntity, { id: guest.user.id }),
    ).not.toBeNull();
  });
});
