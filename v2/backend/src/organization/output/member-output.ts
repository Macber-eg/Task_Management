import type { UserEntity } from "../../database/entities/user.entity";
import type { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";

/** A membership row under the names clients read (`organizationId`, `createdAt`). */
export function memberOutput(member: WorkspaceUserEntity) {
  return {
    id: member.id,
    organizationId: member.workspaceId,
    userId: member.userId,
    role: member.role,
    createdAt: member.joinedAt,
  };
}

export function memberUserOutput(user: UserEntity) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
  };
}

export type MemberWithUser = ReturnType<typeof memberOutput> & {
  user: ReturnType<typeof memberUserOutput>;
};

export function memberWithUserOutput(
  member: WorkspaceUserEntity,
  user: UserEntity,
): MemberWithUser {
  return { ...memberOutput(member), user: memberUserOutput(user) };
}
