import { Global, Module } from "@nestjs/common";
import { NotificationMailer } from "../notification-preferences/delivery/notification-mailer";
import { InvitationMailer } from "../organization/invitations/invitation-mailer";
import { BackgroundEmailDeliveries } from "./background-email-deliveries";
import { EmailTransport } from "./email-transport";
import { EmailService } from "./email.service";
import { SmtpEmailTransport } from "./smtp-email-transport";
import { SmtpInvitationMailer } from "./smtp-invitation-mailer";
import { SmtpNotificationMailer } from "./smtp-notification-mailer";

/**
 * Renders and sends Kaneo's emails, and provides the mailers other modules
 * declare as abstract seams. A module that also registers a no-op for one of
 * those seams in its own providers shadows the real one.
 */
@Global()
@Module({
  providers: [
    EmailService,
    BackgroundEmailDeliveries,
    { provide: EmailTransport, useClass: SmtpEmailTransport },
    { provide: InvitationMailer, useClass: SmtpInvitationMailer },
    { provide: NotificationMailer, useClass: SmtpNotificationMailer },
  ],
  exports: [
    EmailService,
    BackgroundEmailDeliveries,
    InvitationMailer,
    NotificationMailer,
  ],
})
export class EmailModule {}
