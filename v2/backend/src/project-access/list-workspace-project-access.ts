import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import type { MemberProjectAccess } from "./member-project-access-type";

type Rule = { userId: string; projectAccess: string };
type Grant = { userId: string; projectId: string };

/**
 * The members limited to selected projects. Each one's projects are narrowed
 * to those the viewer may see.
 */
export async function listWorkspaceProjectAccess(
  manager: EntityManager,
  workspaceId: string,
  viewerId: string,
): Promise<MemberProjectAccess[]> {
  const [rules, grants] = (await Promise.all([
    manager.query(
      `SELECT user_id AS "userId", project_access AS "projectAccess"
       FROM workspace_member_access
       WHERE workspace_id = $1`,
      [workspaceId],
    ),
    manager.query(
      `SELECT g.user_id AS "userId", g.project_id AS "projectId"
       FROM workspace_member_project AS g
       WHERE g.workspace_id = $1
         AND ${projectAccessCondition("$2", "g.project_id")}`,
      [workspaceId, viewerId],
    ),
  ])) as [Rule[], Grant[]];

  return rules
    .filter((rule) => rule.projectAccess !== "all")
    .map((rule) => ({
      userId: rule.userId,
      projectAccess: "selected" as const,
      projectIds: grants
        .filter((grant) => grant.userId === rule.userId)
        .map((grant) => grant.projectId),
    }));
}
