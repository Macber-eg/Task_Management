import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import type { UserEntity } from "../../../src/database/entities/user.entity";
import { WorkspaceEntity } from "../../../src/database/entities/workspace.entity";
import { addWorkspaceMember } from "./add-workspace-member";
import { createUser } from "./create-user";
import { insertRow } from "./insert-row";
import { seedWorkspaceRoles } from "./seed-workspace-roles";

export type SeededMemberContext = {
  user: UserEntity;
  workspace: WorkspaceEntity;
};

/** A new user in a new workspace of their own, with the default roles seeded. */
export async function createWorkspaceMember(
  db: EntityManager,
  overrides?: Partial<{
    userName: string;
    workspaceName: string;
    role: string;
  }>,
): Promise<SeededMemberContext> {
  const user = await createUser(db, {
    name: overrides?.userName || "Integration Test User",
  });

  const workspace = await insertRow(db, WorkspaceEntity, {
    id: `workspace-${randomUUID()}`,
    createdAt: new Date(),
    name: overrides?.workspaceName || "Integration Test Workspace",
    slug: `workspace-${randomUUID()}`,
  });

  await seedWorkspaceRoles(db, workspace.id);
  await addWorkspaceMember(db, workspace.id, user.id, overrides?.role);

  return { user, workspace };
}
