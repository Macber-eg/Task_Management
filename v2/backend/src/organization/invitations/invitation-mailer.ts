import type { UserEntity } from "../../database/entities/user.entity";
import type { WorkspaceEntity } from "../../database/entities/workspace.entity";
import type { InvitationOutput } from "../output/invitation-output";

export type InvitationEmail = {
  invitation: InvitationOutput;
  workspace: WorkspaceEntity;
  inviter: UserEntity;
};

/**
 * Delivers the email for a new or resent invitation. Throwing means delivery
 * failed: the invitation is kept and the caller is told so (502), so it can
 * be resent. An instance without email delivery should return, not throw.
 */
export abstract class InvitationMailer {
  abstract sendInvitation(email: InvitationEmail): Promise<void>;
}
