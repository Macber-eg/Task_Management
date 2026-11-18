import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  type InvitationEmail,
  InvitationMailer,
} from "../organization/invitations/invitation-mailer";
import { EmailService } from "./email.service";
import { getUserLocale } from "./get-user-locale";
import {
  getInvitationEmailSubject,
  getInvitationRoleLabel,
  getWorkspaceInvitationEmailCopy,
} from "./invitation-email-copy";

@Injectable()
export class SmtpInvitationMailer extends InvitationMailer {
  private readonly logger = new Logger(SmtpInvitationMailer.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly emails: EmailService,
  ) {
    super();
  }

  async sendInvitation({
    invitation,
    workspace,
    inviter,
  }: InvitationEmail): Promise<void> {
    const inviteLink = `${process.env.KANEO_CLIENT_URL}/invitation/accept/${invitation.id}`;
    const locale = await getUserLocale(
      this.dataSource.manager,
      invitation.email,
    );

    const result = await this.emails.sendWorkspaceInvitationEmail(
      invitation.email,
      getInvitationEmailSubject(locale, inviter.name, workspace.name),
      {
        inviterEmail: inviter.email,
        inviterName: inviter.name,
        workspaceName: workspace.name,
        invitationLink: inviteLink,
        to: invitation.email,
        locale,
        role: getInvitationRoleLabel(locale, invitation.role ?? ""),
        expiresAt: invitation.expiresAt,
        copy: getWorkspaceInvitationEmailCopy(locale),
      },
    );

    if (result.success === false && result.reason === "SMTP_NOT_CONFIGURED") {
      this.logger.warn(
        "Invitation created but email not sent due to SMTP not being configured",
      );
    }
  }
}
