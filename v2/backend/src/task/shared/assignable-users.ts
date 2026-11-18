import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../../access/project-access-condition";
import { HTTPException } from "../../common/errors/http-exception";

export const NOT_ASSIGNABLE = "Assignee is not a member of this workspace";
export const NO_PROJECT_ACCESS =
  "Assignee does not have access to this project";

/** Workspace members, plus instance admins, among `userIds`. */
export async function filterAssignableUsers(
  manager: EntityManager,
  userIds: string[],
  workspaceId: string,
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const memberships = (await manager.query(
    `SELECT user_id AS "userId" FROM workspace_member
     WHERE user_id = ANY($1::text[]) AND workspace_id = $2`,
    [userIds, workspaceId],
  )) as { userId: string }[];

  const assignable = new Set(memberships.map((row) => row.userId));
  const remaining = userIds.filter((id) => !assignable.has(id));

  if (remaining.length === 0) {
    return assignable;
  }

  const admins = (await manager.query(
    `SELECT id FROM "user"
     WHERE id = ANY($1::text[]) AND 'admin' = ANY(string_to_array(role, ','))`,
    [remaining],
  )) as { id: string }[];

  for (const admin of admins) {
    assignable.add(admin.id);
  }

  return assignable;
}

/** The users among `userIds` who may see the project. */
export async function filterUsersWithProjectAccess(
  manager: EntityManager,
  userIds: Iterable<string>,
  projectId: string,
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();

  const rows = (await manager.query(
    `SELECT u.id FROM "user" AS u
     WHERE u.id = ANY($1::text[]) AND ${projectAccessCondition("u.id", "$2")}`,
    [ids, projectId],
  )) as { id: string }[];

  return new Set(rows.map((row) => row.id));
}

export async function assertAssignableUser(
  manager: EntityManager,
  userId: string,
  workspaceId: string,
  projectIds: string | readonly string[],
): Promise<void> {
  const assignable = await filterAssignableUsers(
    manager,
    [userId],
    workspaceId,
  );

  if (!assignable.has(userId)) {
    throw new HTTPException(403, { message: NOT_ASSIGNABLE });
  }

  const ids = [
    ...new Set(typeof projectIds === "string" ? [projectIds] : projectIds),
  ];
  if (ids.length === 0) return;
  const [denied] = (await manager.query(
    `SELECT p.id FROM project AS p
     WHERE p.id = ANY($2::text[]) AND NOT ${projectAccessCondition("$1", "p.id")}
     LIMIT 1`,
    [userId, ids],
  )) as { id: string }[];
  if (denied) {
    throw new HTTPException(403, { message: NO_PROJECT_ACCESS });
  }
}

export async function getProjectWorkspaceId(
  manager: EntityManager,
  projectId: string,
): Promise<string> {
  const [project] = (await manager.query(
    `SELECT workspace_id AS "workspaceId" FROM project WHERE id = $1 LIMIT 1`,
    [projectId],
  )) as { workspaceId: string }[];

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  return project.workspaceId;
}
