import { and, asc, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectPhaseTable } from "../../database/schema";
import { assertValidPhaseParent } from "../phase-parent";

type ReorderPhaseItem = {
  id: string;
  position: number;
  parentId?: string | null;
};

async function reorderPhases(projectId: string, phases: ReorderPhaseItem[]) {
  if (phases.length === 0) {
    throw new HTTPException(400, { message: "No phases to reorder" });
  }

  return db.transaction(async (tx) => {
    for (const item of [...phases].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      const [existing] = await tx
        .select()
        .from(projectPhaseTable)
        .where(
          and(
            eq(projectPhaseTable.id, item.id),
            eq(projectPhaseTable.projectId, projectId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new HTTPException(400, {
          message: `Folder ${item.id} does not belong to this project`,
        });
      }

      const nextParentId =
        item.parentId === undefined
          ? existing.parentId
          : item.parentId === ""
            ? null
            : item.parentId;

      if (item.parentId !== undefined) {
        await assertValidPhaseParent({
          projectId,
          parentId: nextParentId,
          phaseId: item.id,
        });
      }

      await tx
        .update(projectPhaseTable)
        .set({
          position: item.position,
          ...(item.parentId !== undefined ? { parentId: nextParentId } : {}),
        })
        .where(eq(projectPhaseTable.id, item.id));
    }

    return tx
      .select()
      .from(projectPhaseTable)
      .where(
        and(
          eq(projectPhaseTable.projectId, projectId),
          isNull(projectPhaseTable.archivedAt),
        ),
      )
      .orderBy(asc(projectPhaseTable.position));
  });
}

export default reorderPhases;
