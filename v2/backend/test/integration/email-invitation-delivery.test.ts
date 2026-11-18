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
import { signUpBrowser } from "../support/browser";
import { createUser } from "../support/fixtures/create-user";
import { linkIn } from "../support/fixtures/email-browser";
import { readErrorBody } from "../support/read-error-body";
import { resetTestDatabase } from "../support/reset-test-database";
import { createTestApp, type TestApp } from "../support/test-app";

describe("invitation emails", () => {
  let app: TestApp;

  async function ownerOfAgency() {
    const owner = await signUpBrowser(app, "owner@example.com", "Olivia");
    const created = await owner.post("/api/auth/organization/create", {
      name: "Agency",
      slug: "agency",
    });
    expect(created.status).toBe(200);
    return owner;
  }

  beforeAll(async () => {
    app = await createTestApp({ realAuth: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(app.dataSource);
    app.emails.clear();
    vi.stubEnv("SMTP_HOST", "smtp.example.test");
    vi.stubEnv("SMTP_FROM", "Kaneo <kaneo@example.test>");
    vi.stubEnv("KANEO_CLIENT_URL", "http://localhost:5173");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("emails the invitation in the invitee's language with the accept link", async () => {
    const owner = await ownerOfAgency();
    await createUser(app.db, { email: "client@example.com", locale: "de-DE" });

    const response = await owner.post("/api/auth/organization/invite-member", {
      email: "client@example.com",
      role: "member",
    });
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };

    const [email] = app.emails.sent;
    expect(email).toMatchObject({
      from: "Kaneo <kaneo@example.test>",
      to: "client@example.com",
      subject: "Olivia hat dich eingeladen, Agency auf Kaneo beizutreten",
    });
    const link = linkIn(email?.html ?? "", "/invitation/accept/");
    expect(link.origin + link.pathname).toBe(
      `http://localhost:5173/invitation/accept/${id}`,
    );
    expect(link.searchParams.get("email")).toBe("client@example.com");
    expect(email?.html).toContain("Mitglied");
  });

  it("saves the invitation without sending when SMTP is not configured", async () => {
    const owner = await ownerOfAgency();
    vi.stubEnv("SMTP_HOST", "");

    const response = await owner.post("/api/auth/organization/invite-member", {
      email: "client@example.com",
      role: "member",
    });
    expect(response.status).toBe(200);
    expect(app.emails.sent).toHaveLength(0);
    expect(await app.db.count(InvitationEntity)).toBe(1);
  });

  it("reports a failed delivery with INVITATION_EMAIL_FAILED and keeps the invitation", async () => {
    const owner = await ownerOfAgency();
    app.emails.failWith = new Error("connect ECONNREFUSED");

    const failed = await owner.post("/api/auth/organization/invite-member", {
      email: "client@example.com",
      role: "member",
    });
    expect(failed.status).toBe(502);
    expect(await readErrorBody(failed)).toEqual({
      code: "INVITATION_EMAIL_FAILED",
      message:
        "Invitation saved, but email delivery failed. Check SMTP settings and resend the invitation.",
    });
    expect(await app.db.count(InvitationEntity)).toBe(1);
    expect(await app.db.count(UserEntity)).toBe(1);
  });
});
