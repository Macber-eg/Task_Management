import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { WorkspaceEntity } from "../../../src/database/entities/workspace.entity";
import { addWorkspaceMember } from "./add-workspace-member";
import { createUser } from "./create-user";
import { insertRow } from "./insert-row";
import type { SeededMemberContext } from "./create-workspace-member";

/**
 * A new user in a new workspace with no stored role rows, as the previous
 * suite's fixture created it: permissions come from the compiled-in roles
 * unless the test stores its own `workspace_role` rows.
 */
export async function createUnseededWorkspaceMember(
  db: EntityManager,
  role = "member",
): Promise<SeededMemberContext> {
  const user = await createUser(db);
  const workspace = await insertRow(db, WorkspaceEntity, {
    id: `workspace-${randomUUID()}`,
    createdAt: new Date(),
    name: "Integration Test Workspace",
    slug: `workspace-${randomUUID()}`,
  });
  await addWorkspaceMember(db, workspace.id, user.id, role);
  return { user, workspace };
}
