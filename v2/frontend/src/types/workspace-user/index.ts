import type {
  Invitation,
  MemberWithUser,
  UserInvitation as AuthUserInvitation,
} from "@/lib/auth/types";

export type WorkspaceUser = MemberWithUser;

// Active workspace member (current user's membership)
export type ActiveWorkspaceUser = MemberWithUser;

// Workspace invitation types
export type WorkspaceUserInvitation = Invitation;

export type UserInvitation = AuthUserInvitation;

export default WorkspaceUser;
