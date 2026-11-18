import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";

export const VIRTUAL_STATUSES = ["planned", "archived"] as const;

export async function getValidTaskStatuses(
  manager: EntityManager,
  projectId: string,
): Promise<string[]> {
  const columns = (await manager.query(
    `SELECT slug FROM "column" WHERE project_id = $1 ORDER BY position ASC`,
    [projectId],
  )) as { slug: string }[];

  return [...columns.map((c) => c.slug), ...VIRTUAL_STATUSES];
}

export async function assertValidTaskStatus(
  manager: EntityManager,
  status: string,
  projectId: string,
): Promise<void> {
  const validStatuses = await getValidTaskStatuses(manager, projectId);

  if (!validStatuses.includes(status)) {
    throw new HTTPException(400, {
      message: `Invalid status "${status}". Valid statuses for this project: ${validStatuses.join(", ")}`,
    });
  }
}

export function coerceStatus(
  status: string,
  validStatuses: string[],
): { status: string; warning?: string } {
  if (validStatuses.includes(status)) {
    return { status };
  }
  return {
    status: "planned",
    warning: `Unknown status "${status}" mapped to "planned"`,
  };
}

/** The workflow column a status slug refers to, if the project has one. */
export async function findStatusColumnId(
  manager: EntityManager,
  projectId: string,
  status: string,
): Promise<string | null> {
  const [column] = (await manager.query(
    `SELECT id FROM "column" WHERE project_id = $1 AND slug = $2 LIMIT 1`,
    [projectId, status],
  )) as { id: string }[];
  return column?.id ?? null;
}
