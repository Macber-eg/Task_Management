import type { EntityManager } from "typeorm";
import { UserEntity } from "../../database/entities/user.entity";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";

export type FoundMember = { member: WorkspaceUserEntity; user: UserEntity };

function withUser(member: WorkspaceUserEntity | null): FoundMember | null {
  if (!member?.user) return null;
  const { user, ...row } = member;
  return { member: row, user };
}

export async function findMember(
  manager: EntityManager,
  userId: string,
  workspaceId: string,
): Promise<FoundMember | null> {
  return withUser(
    await manager.findOne(WorkspaceUserEntity, {
      where: { userId, workspaceId },
      relations: { user: true },
    }),
  );
}

/** By membership id, in whichever workspace it belongs to. */
export async function findMemberById(
  manager: EntityManager,
  id: string,
): Promise<FoundMember | null> {
  return withUser(
    await manager.findOne(WorkspaceUserEntity, {
      where: { id },
      relations: { user: true },
    }),
  );
}

export async function findMemberByEmail(
  manager: EntityManager,
  email: string,
  workspaceId: string,
): Promise<FoundMember | null> {
  const user = await manager.findOne(UserEntity, {
    where: { email: email.toLowerCase() },
  });
  if (!user) return null;
  const member = await manager.findOne(WorkspaceUserEntity, {
    where: { userId: user.id, workspaceId },
  });
  return member ? { member, user } : null;
}

export function countMembers(manager: EntityManager, workspaceId: string) {
  return manager.count(WorkspaceUserEntity, { where: { workspaceId } });
}
