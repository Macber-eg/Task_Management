import type { NotificationEmail } from "./notification-email";

/**
 * Sends a notification email (the `@kaneo/email` notification template).
 * Throwing marks this channel's delivery as failed; the other channels still
 * run. An instance without SMTP should return, not throw.
 */
export abstract class NotificationMailer {
  abstract sendNotificationEmail(
    to: string,
    subject: string,
    email: NotificationEmail,
  ): Promise<void>;
}
