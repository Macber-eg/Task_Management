import { Injectable } from "@nestjs/common";
import type { NotificationEmail } from "../notification-preferences/delivery/notification-email";
import { NotificationMailer } from "../notification-preferences/delivery/notification-mailer";
import { EmailService } from "./email.service";

/** Without SMTP the email channel is skipped; a delivery failure throws. */
@Injectable()
export class SmtpNotificationMailer extends NotificationMailer {
  constructor(private readonly emails: EmailService) {
    super();
  }

  async sendNotificationEmail(
    to: string,
    subject: string,
    email: NotificationEmail,
  ): Promise<void> {
    await this.emails.sendNotificationEmail(to, subject, email);
  }
}
