import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";

/** The users among `userIds` who may see the project. */
export async function filterUsersWithProjectAccess(
  manager: EntityManager,
  userIds: Iterable<string>,
  projectId: string,
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();

  const rows = (await manager.query(
    `SELECT candidate.id FROM "user" AS candidate
     WHERE candidate.id = ANY($1::text[])
       AND ${projectAccessCondition("candidate.id", "$2")}`,
    [ids, projectId],
  )) as { id: string }[];

  return new Set(rows.map((row) => row.id));
}
