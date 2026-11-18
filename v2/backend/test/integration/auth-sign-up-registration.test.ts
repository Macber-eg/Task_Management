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
import { InvitationEntity } from "../../src/database/entities/invitation.entity";
import { UserEntity } from "../../src/database/entities/user.entity";
import { createInvitation } from "../support/fixtures/create-invitation";
import { createWorkspaceMember } from "../support/fixtures/create-workspace-member";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

const FLAGS = [
  "DISABLE_REGISTRATION",
  "DISABLE_PASSWORD_REGISTRATION",
  "DISABLE_LOGIN_FORM",
  "KANEO_CLOUD",
] as const;

const PASSWORD = "test-password-at-least-12";

const LINK_REQUIRED =
  "Registration is currently disabled. Please use a valid invitation link to create an account.";
const INVITATION_REQUIRED =
  "Registration is currently disabled. You need a valid invitation to create an account.";

describe("API integration: email sign-up registration policy", () => {
  let app: TestApp;

  function signUp(
    email: string,
    options: {
      body?: Record<string, unknown>;
      query?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    return app.request(`/api/auth/sign-up/email${options.query ?? ""}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: JSON.stringify({
        name: "Test",
        email,
        password: PASSWORD,
        ...options.body,
      }),
    });
  }

  async function invitation(email: string) {
    const inviter = await createWorkspaceMember(app.db, { role: "owner" });
    return createInvitation(app.db, {
      email,
      workspaceId: inviter.workspace.id,
      inviterId: inviter.user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  async function admins() {
    return app.db.findBy(UserEntity, { role: "admin" });
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("lets the first account set the instance up whatever the flags say", async () => {
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    vi.stubEnv("DISABLE_PASSWORD_REGISTRATION", "true");
    vi.stubEnv("KANEO_CLOUD", "true");

    expect((await signUp("first@mailinator.com")).status).toBe(200);
    expect(await admins()).toEqual([
      expect.objectContaining({ email: "first@mailinator.com" }),
    ]);
  });

  it("refuses password registration once the instance is set up", async () => {
    await createWorkspaceMember(app.db);
    vi.stubEnv("DISABLE_PASSWORD_REGISTRATION", "true");

    const response = await signUp("new@example.com");

    expect(response.status).toBe(403);
    expect(await readErrorBody(response)).toEqual({
      code: "PASSWORD_REGISTRATION_DISABLED",
      message:
        "Password registration is currently disabled. Please use a configured social or OIDC sign-in method.",
    });
    expect(await app.db.findOneBy(UserEntity, { email: "new@example.com" }))
      .toBeNull();
  });

  it("applies the policy before checking the address, as the previous API did", async () => {
    const { user } = await createWorkspaceMember(app.db);
    vi.stubEnv("DISABLE_PASSWORD_REGISTRATION", "true");

    const response = await signUp(user.email);

    expect(response.status).toBe(403);
    expect((await readErrorBody(response)).code).toBe(
      "PASSWORD_REGISTRATION_DISABLED",
    );
  });

  it("refuses disposable addresses on cloud only", async () => {
    await createWorkspaceMember(app.db);

    expect((await signUp("self-hosted@mailinator.com")).status).toBe(200);

    vi.stubEnv("KANEO_CLOUD", "true");
    const response = await signUp("abuse@dwv.dropmail.me");
    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toEqual({
      code: "DISPOSABLE_EMAIL_NOT_ALLOWED",
      message: "Sign-up with disposable email addresses is not allowed.",
    });
    expect((await signUp("real@example.com")).status).toBe(200);
  });

  it("requires a valid invitation link while registration is disabled", async () => {
    const invite = await invitation("invitee@example.com");
    vi.stubEnv("DISABLE_REGISTRATION", "true");

    const withoutLink = await signUp(invite.email);
    expect(withoutLink.status).toBe(403);
    expect(await readErrorBody(withoutLink)).toEqual({
      code: "REGISTRATION_NOT_ALLOWED",
      message: LINK_REQUIRED,
    });

    const wrongId = await signUp(invite.email, {
      headers: { "x-invitation-id": "wrong" },
    });
    expect(wrongId.status).toBe(403);
    expect(await readErrorBody(wrongId)).toEqual({
      code: "REGISTRATION_NOT_ALLOWED",
      message: INVITATION_REQUIRED,
    });

    const otherAddress = await signUp("other@example.com", {
      headers: { "x-invitation-id": invite.id },
    });
    expect(otherAddress.status).toBe(403);

    // A malformed id is dropped, so it reads as no link at all.
    const malformed = await signUp(invite.email, {
      headers: { "x-invitation-id": "not an id" },
    });
    expect((await readErrorBody(malformed)).message).toBe(LINK_REQUIRED);

    expect(
      (await signUp(invite.email, { headers: { "x-invitation-id": invite.id } }))
        .status,
    ).toBe(200);
    expect(
      await app.db.findOneBy(UserEntity, { email: "other@example.com" }),
    ).toBeNull();
  });

  it.each([
    ["the body", (id: string) => ({ body: { invitationId: id } })],
    ["the query string", (id: string) => ({ query: `?invitationId=${id}` })],
    ["a header", (id: string) => ({ headers: { "x-invitation-id": id } })],
  ])("reads the invitation id from %s", async (_source, place) => {
    const invite = await invitation("Invitee@Example.com");
    vi.stubEnv("DISABLE_REGISTRATION", "true");

    expect((await signUp("INVITEE@example.com", place(invite.id))).status).toBe(
      200,
    );
  });

  it("matches the invitation against the body's address before x-invitation-email", async () => {
    const invite = await invitation("invitee@example.com");
    vi.stubEnv("DISABLE_REGISTRATION", "true");

    const response = await signUp("other@example.com", {
      headers: {
        "x-invitation-id": invite.id,
        "x-invitation-email": invite.email,
      },
    });

    expect(response.status).toBe(403);
    expect((await readErrorBody(response)).code).toBe(
      "REGISTRATION_NOT_ALLOWED",
    );
  });

  it("does not accept an accepted or expired invitation", async () => {
    const accepted = await invitation("accepted@example.com");
    await app.db.update(
      InvitationEntity,
      { id: accepted.id },
      { status: "accepted" },
    );
    const expired = await invitation("expired@example.com");
    await app.db.update(
      InvitationEntity,
      { id: expired.id },
      { expiresAt: new Date(Date.now() - 1_000) },
    );
    vi.stubEnv("DISABLE_REGISTRATION", "true");

    for (const invite of [accepted, expired]) {
      const response = await signUp(invite.email, {
        headers: { "x-invitation-id": invite.id },
      });
      expect(response.status).toBe(403);
      expect((await readErrorBody(response)).message).toBe(
        INVITATION_REQUIRED,
      );
    }
  });

  it("keeps one admin through concurrent HTTP first signups", async () => {
    const responses = await Promise.all(
      [1, 2, 3, 4].map((n) => signUp(`race-${n}@example.com`)),
    );

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ]);
    expect(await admins()).toHaveLength(1);
  });

  it("does not give a new signup admin rights on an older instance lacking an admin", async () => {
    const { user } = await createWorkspaceMember(app.db);
    // Unambiguously older across database and application clocks.
    await app.db.update(
      UserEntity,
      { id: user.id },
      { createdAt: new Date("2020-01-01") },
    );

    expect((await signUp("new@example.com")).status).toBe(200);
    expect(await admins()).toHaveLength(0);
  });
});
