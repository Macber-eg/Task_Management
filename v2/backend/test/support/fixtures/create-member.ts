import type { EntityManager } from "typeorm";
import type { UserEntity } from "../../../src/database/entities/user.entity";
import { addWorkspaceMember } from "./add-workspace-member";
import { createUser } from "./create-user";

/** A new user who joins an existing workspace. */
export async function createMember(
  db: EntityManager,
  workspaceId: string,
  role = "member",
): Promise<UserEntity> {
  const user = await createUser(db, { name: `Member ${role}` });
  await addWorkspaceMember(db, workspaceId, user.id, role);
  return user;
}
