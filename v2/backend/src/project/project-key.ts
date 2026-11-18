import type { EntityManager } from "typeorm";

export function isSameProjectKey(a: string, b: string) {
  return (
    a.normalize("NFKC").toLowerCase() === b.normalize("NFKC").toLowerCase()
  );
}

/**
 * Another project in the workspace whose key matches `key` after NFKC and
 * case folding. SQL narrows the candidates (any non-ASCII key may normalize
 * to a match); the final comparison happens here.
 */
export async function findProjectKeyConflict(
  manager: EntityManager,
  workspaceId: string,
  key: string,
  { excludeProjectId }: { excludeProjectId?: string } = {},
): Promise<{ name: string; slug: string } | undefined> {
  const parameters = [workspaceId, key.normalize("NFKC")];
  if (excludeProjectId) parameters.push(excludeProjectId);
  const projects = (await manager.query(
    `SELECT name, slug FROM project
     WHERE workspace_id = $1
       AND (lower(slug) = lower($2)
         OR octet_length(slug) <> char_length(slug))
       ${excludeProjectId ? "AND id <> $3" : ""}`,
    parameters,
  )) as { name: string; slug: string }[];

  return projects.find((project) => isSameProjectKey(project.slug, key));
}

export function projectKeyTakenMessage(key: string, projectName: string) {
  return `This workspace already has a project using the key "${key}" (${projectName}). Choose a different key.`;
}
