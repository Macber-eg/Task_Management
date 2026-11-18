import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EmailMessage, EmailTransport } from "./email-transport";
import { EmailService } from "./email.service";

class RecordingTransport extends EmailTransport {
  readonly sent: EmailMessage[] = [];
  failure: Error | null = null;

  async sendMail(message: EmailMessage): Promise<void> {
    if (this.failure) throw this.failure;
    this.sent.push(message);
  }
}

const invitation = {
  workspaceName: "Acme",
  inviterName: "Ada",
  inviterEmail: "ada@example.com",
  invitationLink: "https://kaneo.example/invitation/accept/1",
  to: "bob@example.com",
};

describe("EmailService", () => {
  let transport: RecordingTransport;
  let emails: EmailService;

  beforeEach(() => {
    vi.stubEnv("SMTP_HOST", "relay.internal");
    vi.stubEnv("SMTP_FROM", "Kaneo <kaneo@example.com>");
    transport = new RecordingTransport();
    emails = new EmailService(transport);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("renders and sends from SMTP_FROM", async () => {
    await emails.sendOtpEmail("bob@example.com", "123456 is your code", {
      otp: "123456",
    });
    expect(transport.sent).toEqual([
      {
        from: "Kaneo <kaneo@example.com>",
        to: "bob@example.com",
        subject: "123456 is your code",
        html: expect.stringContaining("123456"),
      },
    ]);
  });

  it("reports an invitation as unsent without SMTP, and throws when delivery fails", async () => {
    vi.stubEnv("SMTP_FROM", "");
    expect(
      await emails.sendWorkspaceInvitationEmail("bob@example.com", "Join", invitation),
    ).toEqual({ success: false, reason: "SMTP_NOT_CONFIGURED" });
    expect(transport.sent).toHaveLength(0);

    vi.stubEnv("SMTP_FROM", "Kaneo <kaneo@example.com>");
    transport.failure = Object.assign(new Error("secret@example.com rejected"), {
      code: "EENVELOPE",
    });
    await expect(
      emails.sendWorkspaceInvitationEmail("bob@example.com", "Join", invitation),
    ).rejects.toThrow();
  });

  it("never throws for a failed sign-in or recovery email", async () => {
    transport.failure = new Error("unreachable relay");
    await expect(
      emails.sendMagicLinkEmail("bob@example.com", "Login", {
        magicLink: "https://kaneo.example/link",
      }),
    ).resolves.toBeUndefined();
    await expect(
      emails.sendPasswordResetEmail("bob@example.com", "Reset", {
        resetLink: "https://kaneo.example/reset",
      }),
    ).resolves.toBeUndefined();
  });
});
