import { Injectable, Logger } from "@nestjs/common";
import { render } from "@react-email/components";
import { instanceHost } from "./components/instance-host";
import { EmailTransport } from "./email-transport";
import { isSmtpConfigured } from "./smtp-config";
import { getSmtpErrorDetails } from "./smtp-error-details";
import MagicLinkEmail, { type MagicLinkEmailProps } from "./templates/magic-link";
import NotificationEmail, {
  type NotificationEmailProps,
} from "./templates/notification";
import OtpEmail, { type OtpEmailProps } from "./templates/otp";
import PasswordResetEmail, {
  type PasswordResetEmailProps,
} from "./templates/password-reset";
import TrialReminderEmail, {
  type TrialReminderEmailProps,
} from "./templates/trial-reminder";
import WorkspaceInvitationEmail, {
  type WorkspaceInvitationEmailProps,
} from "./templates/workspace-invitation";

export type EmailResult = {
  success: boolean;
  reason?: "SMTP_NOT_CONFIGURED";
};

/**
 * One method per email. Sign-in and recovery mail never throws for a
 * delivery failure (it is logged); invitation and notification mail reports
 * whether SMTP is configured and throws when delivery fails, so callers can
 * tell the user. Logs carry only the SMTP error category: provider errors can
 * contain addresses, tokens or credentials.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly transport: EmailTransport) {}

  async sendMagicLinkEmail(
    to: string,
    subject: string,
    data: MagicLinkEmailProps,
  ): Promise<void> {
    const html = await render(
      MagicLinkEmail({ email: to, instance: instanceHost(), ...data }),
    );
    await this.deliver(to, subject, html).catch((error: unknown) => {
      this.logger.error(
        "Error sending magic link email",
        getSmtpErrorDetails(error),
      );
    });
  }

  async sendOtpEmail(
    to: string,
    subject: string,
    data: OtpEmailProps,
  ): Promise<void> {
    const html = await render(
      OtpEmail({ email: to, instance: instanceHost(), ...data }),
    );
    await this.deliver(to, subject, html).catch((error: unknown) => {
      this.logger.error("Error sending OTP email", getSmtpErrorDetails(error));
    });
  }

  async sendPasswordResetEmail(
    to: string,
    subject: string,
    data: PasswordResetEmailProps,
  ): Promise<void> {
    let html: string;
    try {
      html = await render(
        PasswordResetEmail({ email: to, instance: instanceHost(), ...data }),
      );
    } catch {
      this.logger.error("Error rendering password reset email");
      return;
    }
    await this.deliver(to, subject, html).catch((error: unknown) => {
      this.logger.error(
        "Error sending password reset email",
        getSmtpErrorDetails(error),
      );
    });
  }

  async sendWorkspaceInvitationEmail(
    to: string,
    subject: string,
    data: WorkspaceInvitationEmailProps,
  ): Promise<EmailResult> {
    if (!isSmtpConfigured()) {
      return { success: false, reason: "SMTP_NOT_CONFIGURED" };
    }
    try {
      const html = await render(
        WorkspaceInvitationEmail({ instance: instanceHost(), ...data, to }),
      );
      await this.deliver(to, subject, html);
      return { success: true };
    } catch (error) {
      this.logger.error(
        "Error sending workspace invitation email",
        getSmtpErrorDetails(error),
      );
      throw error;
    }
  }

  async sendNotificationEmail(
    to: string,
    subject: string,
    data: NotificationEmailProps,
  ): Promise<EmailResult> {
    if (!isSmtpConfigured()) {
      return { success: false, reason: "SMTP_NOT_CONFIGURED" };
    }
    try {
      const html = await render(NotificationEmail(data));
      await this.deliver(to, subject, html);
      return { success: true };
    } catch (error) {
      this.logger.error(
        "Error sending notification email",
        getSmtpErrorDetails(error),
      );
      throw error;
    }
  }

  async sendTrialReminderEmail(
    to: string,
    subject: string,
    data: TrialReminderEmailProps,
  ): Promise<void> {
    const html = await render(TrialReminderEmail({ email: to, ...data }));
    await this.deliver(to, subject, html).catch((error: unknown) => {
      this.logger.error(
        "Error sending trial reminder email",
        getSmtpErrorDetails(error),
      );
    });
  }

  private deliver(to: string, subject: string, html: string): Promise<void> {
    return this.transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
    });
  }
}
