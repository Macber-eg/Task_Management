import type { EntityManager } from "typeorm";
import { filterUsersWithProjectAccess } from "../../project/filter-users-with-project-access";
import type { AssignableMember } from "./match-assignees";

export async function loadAssignableMembers(
  tx: EntityManager,
  workspaceId: string,
  projectId: string,
): Promise<AssignableMember[]> {
  const members = (await tx.query(
    `SELECT u.id, u.name, u.email FROM workspace_member AS wu
     INNER JOIN "user" AS u ON wu.user_id = u.id
     WHERE wu.workspace_id = $1`,
    [workspaceId],
  )) as AssignableMember[];

  const withAccess = await filterUsersWithProjectAccess(
    tx,
    members.map((member) => member.id),
    projectId,
  );
  return members.filter((member) => withAccess.has(member.id));
}
