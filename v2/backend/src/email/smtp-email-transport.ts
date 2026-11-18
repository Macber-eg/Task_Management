import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { type EmailMessage, EmailTransport } from "./email-transport";
import { getSmtpTransportOptions } from "./smtp-config";

@Injectable()
export class SmtpEmailTransport
  extends EmailTransport
  implements OnApplicationShutdown
{
  // Built at startup, so an unsupported setting (SMTP_IGNORE_TLS=true) stops
  // the process instead of surfacing on the first email.
  private readonly transporter = nodemailer.createTransport(
    getSmtpTransportOptions(),
  );

  async sendMail(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail(message);
  }

  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
