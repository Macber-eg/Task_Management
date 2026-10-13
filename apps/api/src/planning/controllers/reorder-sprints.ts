import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectSprintTable } from "../../database/schema";

type ReorderSprintItem = {
  id: string;
  position: number;
  phaseId?: string | null;
};

async function reorderSprints(projectId: string, sprints: ReorderSprintItem[]) {
  if (sprints.length === 0) {
    throw new HTTPException(400, { message: "No sprints to reorder" });
  }

  return db.transaction(async (tx) => {
    for (const item of [...sprints].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      const [existing] = await tx
        .select()
        .from(projectSprintTable)
        .where(
          and(
            eq(projectSprintTable.id, item.id),
            eq(projectSprintTable.projectId, projectId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new HTTPException(400, {
          message: `Sprint ${item.id} does not belong to this project`,
        });
      }

      const nextPhaseId =
        item.phaseId === undefined
          ? existing.phaseId
          : item.phaseId === ""
            ? null
            : item.phaseId;

      await tx
        .update(projectSprintTable)
        .set({
          position: item.position,
          ...(item.phaseId !== undefined ? { phaseId: nextPhaseId } : {}),
        })
        .where(eq(projectSprintTable.id, item.id));
    }

    return tx
      .select()
      .from(projectSprintTable)
      .where(eq(projectSprintTable.projectId, projectId))
      .orderBy(asc(projectSprintTable.position));
  });
}

export default reorderSprints;
