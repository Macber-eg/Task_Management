import { Injectable } from "@nestjs/common";
import { InvitationMailer } from "./invitation-mailer";

/** Used until email delivery is ported: invitations are saved, not emailed. */
@Injectable()
export class NoopInvitationMailer extends InvitationMailer {
  async sendInvitation(): Promise<void> {}
}
