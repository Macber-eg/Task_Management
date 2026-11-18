import type { EntityManager } from "typeorm";
import { replaceMemberProjectAccess } from "../../../src/project-access/replace-member-project-access";

/** Limits a member to the given projects. */
export function restrictToProjects(
  db: EntityManager,
  workspaceId: string,
  userId: string,
  projectIds: string[],
): Promise<void> {
  return replaceMemberProjectAccess(db, {
    workspaceId,
    userId,
    projectAccess: "selected",
    projectIds,
  });
}
