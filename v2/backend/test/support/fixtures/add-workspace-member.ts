import type { EntityManager } from "typeorm";
import { WorkspaceUserEntity } from "../../../src/database/entities/workspace-user.entity";
import { insertRow } from "./insert-row";

export function addWorkspaceMember(
  db: EntityManager,
  workspaceId: string,
  userId: string,
  role = "member",
): Promise<WorkspaceUserEntity> {
  return insertRow(db, WorkspaceUserEntity, {
    workspaceId,
    userId,
    role,
    joinedAt: new Date(),
  });
}
