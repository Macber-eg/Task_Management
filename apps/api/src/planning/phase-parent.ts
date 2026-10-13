import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectPhaseTable } from "../database/schema";

export async function assertValidPhaseParent({
  projectId,
  parentId,
  phaseId,
}: {
  projectId: string;
  parentId: string | null | undefined;
  phaseId?: string;
}) {
  if (parentId === undefined || parentId === null || parentId === "") {
    return null;
  }

  if (phaseId && parentId === phaseId) {
    throw new HTTPException(400, {
      message: "A folder cannot be its own parent",
    });
  }

  const [parent] = await db
    .select()
    .from(projectPhaseTable)
    .where(
      and(
        eq(projectPhaseTable.id, parentId),
        eq(projectPhaseTable.projectId, projectId),
      ),
    )
    .limit(1);

  if (!parent) {
    throw new HTTPException(400, {
      message: "Parent folder not found in this project",
    });
  }

  if (parent.archivedAt) {
    throw new HTTPException(400, {
      message: "Cannot nest under an archived folder",
    });
  }

  if (parent.kind === "document") {
    throw new HTTPException(400, {
      message: "Documents cannot contain nested items",
    });
  }

  if (phaseId) {
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === phaseId) {
        throw new HTTPException(400, {
          message: "Cannot move a folder inside its own descendant",
        });
      }
      const [row] = await db
        .select({ parentId: projectPhaseTable.parentId })
        .from(projectPhaseTable)
        .where(eq(projectPhaseTable.id, cursor))
        .limit(1);
      cursor = row?.parentId ?? null;
    }
  }

  return parent;
}

export async function nextPhasePosition(
  projectId: string,
  parentId: string | null,
) {
  const [maxPos] = await db
    .select({
      maximum: sql<number>`coalesce(max(${projectPhaseTable.position}), -1)`,
    })
    .from(projectPhaseTable)
    .where(
      and(
        eq(projectPhaseTable.projectId, projectId),
        parentId
          ? eq(projectPhaseTable.parentId, parentId)
          : isNull(projectPhaseTable.parentId),
      ),
    );

  return Number(maxPos?.maximum ?? -1) + 1;
}
